/**
 * Provedores de LLM: Gemini Flash-Lite como principal, Groq como reserva.
 *
 * A escolha é de custo, não de qualidade. A restrição do projeto é validar sem
 * pagar nada: os dois têm tier gratuito com teto por minuto e por dia, e nenhum
 * exige cartão. Se o principal recusar por cota, a rodada continua na reserva
 * em vez de parar — mas o número que sai do harness é sempre por provedor, para
 * não misturar duas qualidades diferentes numa média sem sentido.
 *
 * Zero dependência: os dois falam HTTP e JSON, e `fetch` já vem no Node.
 *
 * O Gemini já rodou contra a API real (24/08, 120 casos do harness). O Groq
 * não: está testado só contra `fetch` injetado, e o id de modelo padrão pode
 * ter envelhecido do mesmo jeito que o do Gemini envelheceu — `gemini-2.5-flash-lite`
 * respondeu 404 dizendo "no longer available to new users". Modelo padrão
 * errado é falha silenciosa até a primeira chamada; conferir antes de confiar.
 */
import { log } from '../logger.ts';

const STATUS_RETENTAVEIS = new Set([408, 429, 500, 502, 503, 504]);
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Cota estourada ou chave inválida: insistir não melhora, mudar de provedor sim. */
export class LlmIndisponivel extends Error {
  status: number;
  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.name = 'LlmIndisponivel';
    this.status = status;
  }
}

export class LlmErro extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'LlmErro';
  }
}

export interface Provedor {
  /** `gemini/gemini-2.5-flash-lite`. Vai para `jobs.classificador`. */
  readonly nome: string;
  /** Recebe o prompt, devolve o texto bruto da resposta (deve ser JSON). */
  julgar(prompt: string, schema: unknown): Promise<string>;
}

export interface OpcoesProvedor {
  chave: string;
  modelo: string;
  /**
   * Espera mínima entre chamadas. O tier gratuito limita REQUISIÇÕES POR
   * MINUTO, não tokens: mandar 14 lotes em sequência estoura o limite e, sem
   * provedor de reserva, mata a rodada inteira. 4,5s deixa ~13 chamadas por
   * minuto, abaixo do teto de 15 do Flash-Lite.
   */
  intervaloMs?: number;
  tentativas?: number;
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
}

abstract class ProvedorHttp implements Provedor {
  abstract readonly nome: string;
  protected chave: string;
  protected modelo: string;
  #intervaloMs: number;
  #ultimaChamadaMs = 0;
  #tentativas: number;
  #backoffBaseMs: number;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  #random: () => number;

  constructor(opts: OpcoesProvedor) {
    this.chave = opts.chave;
    this.modelo = opts.modelo;
    this.#intervaloMs = opts.intervaloMs ?? 4_500;
    this.#tentativas = Math.max(1, opts.tentativas ?? 3);
    this.#backoffBaseMs = opts.backoffBaseMs ?? 1_000;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#sleep = opts.sleepImpl ?? dormir;
    this.#random = opts.randomImpl ?? Math.random;
  }

  protected abstract requisicao(prompt: string, schema: unknown): { url: string; init: RequestInit };
  protected abstract extrairTexto(corpo: unknown): string | null;

  async julgar(prompt: string, schema: unknown): Promise<string> {
    const { url, init } = this.requisicao(prompt, schema);
    let ultimoErro: unknown = null;

    for (let tentativa = 1; tentativa <= this.#tentativas; tentativa++) {
      await this.#respeitarIntervalo();

      let resposta: Response;
      try {
        this.#ultimaChamadaMs = Date.now();
        resposta = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      } catch (erro) {
        ultimoErro = erro;
        log.warn('falha de rede no LLM', { provedor: this.nome, tentativa });
        if (tentativa < this.#tentativas) await this.#sleep(this.#atraso(tentativa));
        continue;
      }

      const corpo = await this.#lerJson(resposta);

      if (resposta.ok) {
        const texto = this.extrairTexto(corpo);
        if (texto === null || texto.trim() === '') {
          // Resposta vazia costuma ser filtro de conteúdo ou corte por token.
          // É defeito do lote, não da rede: retentar igual daria o mesmo.
          throw new LlmErro(`${this.nome} devolveu resposta sem texto`);
        }
        return texto;
      }

      // 429 no tier gratuito é cota do dia, não pico de tráfego: cair para o
      // provedor reserva rende mais que esperar o backoff.
      if (resposta.status === 429 || resposta.status === 401 || resposta.status === 403) {
        throw new LlmIndisponivel(
          `${this.nome} recusou (${resposta.status}): ${this.#mensagem(corpo, resposta)}`,
          resposta.status,
        );
      }
      if (!STATUS_RETENTAVEIS.has(resposta.status)) {
        throw new LlmErro(`${this.nome} ${resposta.status}: ${this.#mensagem(corpo, resposta)}`);
      }

      ultimoErro = new LlmErro(`${this.nome} ${resposta.status}`);
      log.warn('resposta retentável do LLM', { provedor: this.nome, status: resposta.status });
      if (tentativa < this.#tentativas) await this.#sleep(this.#atraso(tentativa));
    }

    throw new LlmErro(`${this.nome} falhou após ${this.#tentativas} tentativas: ${String(ultimoErro)}`);
  }

  async #respeitarIntervalo(): Promise<void> {
    if (this.#ultimaChamadaMs === 0) return;
    const espera = this.#intervaloMs - (Date.now() - this.#ultimaChamadaMs);
    if (espera > 0) await this.#sleep(espera);
  }

  #atraso(tentativa: number): number {
    const teto = Math.min(this.#backoffBaseMs * 2 ** (tentativa - 1), 20_000);
    return Math.round(teto * (0.5 + this.#random() * 0.5));
  }

  async #lerJson(resposta: Response): Promise<unknown> {
    try {
      return await resposta.json();
    } catch {
      return null;
    }
  }

  #mensagem(corpo: unknown, resposta: Response): string {
    const erro = (corpo as { error?: { message?: string } } | null)?.error?.message;
    return erro ?? resposta.statusText;
  }
}

const ENDPOINT_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini Flash-Lite. `responseSchema` faz o próprio modelo garantir o formato,
 * o que elimina a maior fonte de erro do lote — resposta em prosa.
 */
export class ProvedorGemini extends ProvedorHttp {
  readonly nome: string;

  constructor(opts: OpcoesProvedor) {
    super(opts);
    this.nome = `gemini/${opts.modelo}`;
  }

  protected override requisicao(prompt: string, schema: unknown): { url: string; init: RequestInit } {
    return {
      url: `${ENDPOINT_GEMINI}/${this.modelo}:generateContent`,
      init: {
        method: 'POST',
        headers: { 'x-goog-api-key': this.chave, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            // Classificação não quer criatividade: mesma entrada, mesma saída.
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        }),
      },
    };
  }

  protected override extrairTexto(corpo: unknown): string | null {
    const candidatos = (corpo as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null)
      ?.candidates;
    const partes = candidatos?.[0]?.content?.parts;
    if (!Array.isArray(partes)) return null;
    const texto = partes.map((p) => p.text ?? '').join('');
    return texto === '' ? null : texto;
  }
}

const ENDPOINT_GROQ = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Groq. Só aceita `json_object`, sem schema — por isso o prompt descreve o
 * formato em texto e `interpretarResposta` valida campo a campo.
 */
export class ProvedorGroq extends ProvedorHttp {
  readonly nome: string;

  constructor(opts: OpcoesProvedor) {
    super(opts);
    this.nome = `groq/${opts.modelo}`;
  }

  protected override requisicao(prompt: string): { url: string; init: RequestInit } {
    return {
      url: ENDPOINT_GROQ,
      init: {
        method: 'POST',
        headers: { authorization: `Bearer ${this.chave}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.modelo,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      },
    };
  }

  protected override extrairTexto(corpo: unknown): string | null {
    const escolhas = (corpo as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices;
    return escolhas?.[0]?.message?.content ?? null;
  }
}

/**
 * Encadeia provedores: o primeiro que responder ganha o lote.
 *
 * Só `LlmIndisponivel` (cota ou credencial) faz descer para o próximo. Erro de
 * formato ou de rede já foi retentado dentro do provedor; insistir noutro
 * provedor gastaria a cota dele com o mesmo lote defeituoso.
 *
 * `nome` muda a cada lote, para `jobs.classificador` registrar quem de fato
 * decidiu aquela vaga.
 */
export class CadeiaDeProvedores implements Provedor {
  #provedores: Provedor[];
  #ultimo: Provedor | null = null;

  constructor(provedores: Provedor[]) {
    if (provedores.length === 0) throw new Error('cadeia de provedores vazia');
    this.#provedores = provedores;
  }

  get nome(): string {
    return this.#ultimo?.nome ?? this.#provedores[0]!.nome;
  }

  async julgar(prompt: string, schema: unknown): Promise<string> {
    let ultimoErro: unknown = null;

    for (const provedor of this.#provedores) {
      try {
        const texto = await provedor.julgar(prompt, schema);
        this.#ultimo = provedor;
        return texto;
      } catch (erro) {
        ultimoErro = erro;
        if (erro instanceof LlmIndisponivel) {
          log.warn('provedor indisponível, caindo para o próximo', {
            provedor: provedor.nome,
            status: erro.status,
          });
          continue;
        }
        throw erro;
      }
    }

    throw new LlmIndisponivel(
      `todos os provedores indisponíveis: ${String(ultimoErro)}`,
      429,
    );
  }
}

export interface ConfigLlm {
  geminiKey: string;
  geminiModelo: string;
  groqKey: string;
  groqModelo: string;
  intervaloMs?: number;
}

/** Monta a cadeia a partir do ambiente. `null` quando não há nenhuma chave. */
export function cadeiaDoAmbiente(
  config: ConfigLlm,
  fetchImpl?: typeof fetch,
): CadeiaDeProvedores | null {
  const provedores: Provedor[] = [];

  const intervaloMs = config.intervaloMs;

  if (config.geminiKey) {
    provedores.push(
      new ProvedorGemini({
        chave: config.geminiKey,
        modelo: config.geminiModelo,
        intervaloMs,
        fetchImpl,
      }),
    );
  }
  if (config.groqKey) {
    provedores.push(
      new ProvedorGroq({ chave: config.groqKey, modelo: config.groqModelo, intervaloMs, fetchImpl }),
    );
  }

  return provedores.length > 0 ? new CadeiaDeProvedores(provedores) : null;
}
