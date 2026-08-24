/**
 * Cliente da Serper.dev — SERP real do Google via API.
 *
 * Existe por um motivo específico: o Google Alerts entrega FLUXO mas não
 * devolve ACERVO. Sem consultar o índice não dá para reproduzir o Passo 1 nem
 * comparar precisão com os ~46 resultados medidos lá. A Serper aceita `site:`
 * e aspas (é a SERP do Google de verdade) e devolve a URL real, então a
 * canonicalização, a dedup e o `fonte_id` continuam funcionando — as três
 * coisas que o grounding do Gemini quebra.
 *
 * Cota: 2.500 créditos gratuitos, uma vez só, com validade de 6 meses. Não
 * renova. Por isso o contador aqui é ACUMULADO (quanto já se gastou do total),
 * não diário como era o da PSE.
 */
import { log } from '../logger.ts';

const ENDPOINT = 'https://google.serper.dev/search';

export interface ResultadoOrganico {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
  /** A Serper às vezes devolve a data que o Google exibe ("há 3 dias", "10 de ago."). */
  date?: string;
}

export interface RespostaSerper {
  organic?: ResultadoOrganico[];
  credits?: number;
  searchParameters?: Record<string, unknown>;
  message?: string;
}

export class SerperCreditosError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'SerperCreditosError';
  }
}

export class SerperErroFatal extends Error {
  status: number;
  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.name = 'SerperErroFatal';
    this.status = status;
  }
}

export class SerperErroTransitorio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'SerperErroTransitorio';
  }
}

export interface OpcoesBuscaSerper {
  /** 1-based. Página 2 = resultados 11..20. */
  pagina?: number;
  /** Manter em 10: `num` acima de 10 pode custar mais de um crédito por chamada. */
  num?: number;
  /**
   * Janela de tempo do Google: `qdr:w` = última semana, `qdr:d` = último dia.
   * O produto promete vaga de no máximo 7 dias, então `qdr:w` é o padrão de
   * produção — inclusive no bloco de vaga formal, onde o Passo 1 tinha
   * concluído que filtro de data era redundante. A medição de 22/08 mostrou
   * que um terço do que o índice devolve tem mais de 90 dias.
   */
  tbs?: string;
}

export interface OpcoesClienteSerper {
  key: string;
  orcamento: number;
  intervaloMs?: number;
  tentativas?: number;
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
}

const STATUS_RETENTAVEIS = new Set([408, 429, 500, 502, 503, 504]);
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ResultadoBuscaSerper {
  organicos: ResultadoOrganico[];
  /** Créditos que a própria API diz ter cobrado, quando informa. */
  creditosReportados: number | null;
}

export class SerperCliente {
  #key: string;
  #orcamento: number;
  #intervaloMs: number;
  #tentativas: number;
  #backoffBaseMs: number;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  #random: () => number;

  #consumidos = 0;
  #ultimaChamadaMs = 0;

  constructor(opts: OpcoesClienteSerper) {
    this.#key = opts.key;
    this.#orcamento = opts.orcamento;
    this.#intervaloMs = opts.intervaloMs ?? 200;
    this.#tentativas = Math.max(1, opts.tentativas ?? 3);
    this.#backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#sleep = opts.sleepImpl ?? dormir;
    this.#random = opts.randomImpl ?? Math.random;
  }

  get consumidos(): number {
    return this.#consumidos;
  }

  get restante(): number {
    return Math.max(0, this.#orcamento - this.#consumidos);
  }

  async buscar(q: string, opts: OpcoesBuscaSerper = {}): Promise<ResultadoBuscaSerper> {
    if (this.restante <= 0) {
      throw new SerperCreditosError(
        `orçamento da execução esgotado (${this.#consumidos}/${this.#orcamento})`,
      );
    }

    const corpo = JSON.stringify({
      q,
      gl: 'br',
      hl: 'pt-br',
      num: opts.num ?? 10,
      page: opts.pagina ?? 1,
      // Correção automática reescreveria o dork e estragaria a comparação.
      autocorrect: false,
      ...(opts.tbs ? { tbs: opts.tbs } : {}),
    });

    let ultimoErro: unknown = null;

    for (let tentativa = 1; tentativa <= this.#tentativas; tentativa++) {
      await this.#respeitarIntervalo();

      let resposta: Response;
      try {
        this.#consumidos++;
        this.#ultimaChamadaMs = Date.now();
        resposta = await this.#fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'X-API-KEY': this.#key, 'content-type': 'application/json' },
          body: corpo,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (erro) {
        // Não chegou à API: devolve o crédito ao orçamento.
        this.#consumidos--;
        ultimoErro = erro;
        log.warn('falha de rede na Serper', { tentativa, de: this.#tentativas });
        if (tentativa < this.#tentativas) await this.#sleep(this.#atraso(tentativa));
        continue;
      }

      const dados = (await this.#lerJson(resposta)) as RespostaSerper | null;

      if (resposta.ok) {
        return {
          organicos: dados?.organic ?? [],
          creditosReportados: typeof dados?.credits === 'number' ? dados.credits : null,
        };
      }

      const mensagem = dados?.message ?? resposta.statusText;

      // 401/403 = chave errada. 402 = créditos acabaram. Nenhum melhora com retry.
      if (resposta.status === 402) {
        throw new SerperCreditosError(`Serper recusou por créditos: ${mensagem}`);
      }
      if (!STATUS_RETENTAVEIS.has(resposta.status)) {
        throw new SerperErroFatal(`Serper ${resposta.status}: ${mensagem}`, resposta.status);
      }

      ultimoErro = new SerperErroTransitorio(`Serper ${resposta.status}: ${mensagem}`);
      log.warn('resposta retentável da Serper', { status: resposta.status, tentativa });
      if (tentativa < this.#tentativas) await this.#sleep(this.#atraso(tentativa));
    }

    throw new SerperErroTransitorio(
      `Serper falhou após ${this.#tentativas} tentativas: ${String(ultimoErro)}`,
    );
  }

  async #respeitarIntervalo(): Promise<void> {
    if (this.#ultimaChamadaMs === 0) return;
    const espera = this.#intervaloMs - (Date.now() - this.#ultimaChamadaMs);
    if (espera > 0) await this.#sleep(espera);
  }

  #atraso(tentativa: number): number {
    const teto = Math.min(this.#backoffBaseMs * 2 ** (tentativa - 1), 15_000);
    return Math.round(teto * (0.5 + this.#random() * 0.5));
  }

  async #lerJson(resposta: Response): Promise<unknown> {
    try {
      return await resposta.json();
    } catch {
      return null;
    }
  }
}
