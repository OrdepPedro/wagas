/**
 * Cliente PostgREST do Supabase, escrito em fetch puro.
 *
 * Sem `@supabase/supabase-js` de propósito: o coletor precisa de select, insert
 * e rpc. Zero dependência significa `npm ci` instantâneo no Actions, nenhuma
 * árvore de transitivas para auditar e teste rodando sem instalar nada.
 * Quando o Passo 4 trouxer Auth e realtime, aí o SDK se justifica — no frontend.
 *
 * A service_role key ignora RLS. Ela só existe em secret do Actions e em .env
 * local; nunca no frontend.
 */
import { log } from '../logger.ts';

export interface OpcoesInsert {
  /** Ignora linhas que colidem com a constraint em `conflito` em vez de falhar. */
  ignorarDuplicados?: boolean;
  /** ATUALIZA a linha que colide, em vez de ignorá-la. Upsert de verdade. */
  mesclarDuplicados?: boolean;
  conflito?: string;
  /** Devolve as linhas efetivamente gravadas (útil para contar inserções reais). */
  retornar?: boolean;
}

export class SupabaseErro extends Error {
  status: number;
  corpo: string;
  constructor(mensagem: string, status: number, corpo: string) {
    super(mensagem);
    this.name = 'SupabaseErro';
    this.status = status;
    this.corpo = corpo;
  }
}

/**
 * Status que querem dizer "o banco não respondeu a tempo", não "o pedido está
 * errado". 520–524 são do Cloudflare na frente do Supabase: o 522 derrubou a
 * coleta diária de 21/11 e de 24/11 no meio do InfoJobs, com o banco de pé
 * minutos depois.
 */
const STATUS_PASSAGEIRO = new Set([500, 502, 503, 504, 520, 521, 522, 523, 524]);

/** Esperas entre tentativas, em ms. Três repetições, ~50 s no pior caso. */
const ESPERAS_PASSAGEIRO = [5_000, 15_000, 30_000];

const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

export class SupabaseRest {
  #url: string;
  #key: string;
  #fetch: typeof fetch;
  #esperar: (ms: number) => Promise<void>;

  constructor(
    url: string,
    serviceKey: string,
    fetchImpl: typeof fetch = fetch,
    esperar: (ms: number) => Promise<void> = dormir,
  ) {
    this.#url = url.replace(/\/+$/, '');
    this.#key = serviceKey;
    this.#fetch = fetchImpl;
    this.#esperar = esperar;
  }

  #cabecalhos(extras: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.#key,
      authorization: `Bearer ${this.#key}`,
      'content-type': 'application/json',
      ...extras,
    };
  }

  /**
   * `idempotente`: repetir o pedido não muda o resultado. Só aí 5xx e falha de
   * rede são repetidos, porque um 522 não diz se o banco gravou ou não: o pedido
   * pode ter sido aplicado e só a resposta se perdeu. GET, PATCH e DELETE com
   * filtro e insert com `on_conflict` (ignorar ou mesclar) aguentam a repetição;
   * insert simples duplicaria linha e `rpc` (`reservar_saldo`) gastaria saldo
   * duas vezes, então esses falham na hora, como antes.
   *
   * Custo aceito: insert com `ignorarDuplicados` + `retornar` repetido depois de
   * um primeiro envio que gravou devolve zero linhas, e a contagem de "vagas
   * novas" daquela execução sai menor que a real.
   */
  async #requisicao(
    caminho: string,
    init: RequestInit,
    idempotente: boolean,
    tentativa = 1,
  ): Promise<unknown> {
    const passageiras = idempotente ? ESPERAS_PASSAGEIRO.length : 0;
    const repetirPassageiro = async (motivo: Record<string, unknown>) => {
      const espera = ESPERAS_PASSAGEIRO[tentativa - 1]!;
      log.warn('Supabase não respondeu; repetindo', { caminho: caminho.split('?')[0], tentativa, esperaMs: espera, ...motivo });
      await this.#esperar(espera);
      return this.#requisicao(caminho, init, idempotente, tentativa + 1);
    };

    let resposta: Response;
    try {
      resposta = await this.#fetch(`${this.#url}${caminho}`, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (erro) {
      // Rede caída ou os 30 s do timeout: mesma dúvida do 522 sobre ter gravado.
      if (tentativa <= passageiras) return repetirPassageiro({ erro: String(erro).slice(0, 120) });
      throw erro;
    }

    const texto = await resposta.text();
    // "JWT issued at future": o token que o Supabase gera a partir da chave
    // `sb_secret_` saiu com relógio alguns segundos adiantado. Derrubou a
    // primeira execução da coleta diária no Actions (22/10) e passou sozinho na
    // seguinte. Esperar e repetir resolve; qualquer outro 401 é chave errada e
    // falha na hora. O pedido nem chegou ao banco, então vale para qualquer método.
    if (resposta.status === 401 && texto.includes('PGRST303') && tentativa < 3) {
      await this.#esperar(3000 * tentativa);
      return this.#requisicao(caminho, init, idempotente, tentativa + 1);
    }
    if (STATUS_PASSAGEIRO.has(resposta.status) && tentativa <= passageiras) {
      return repetirPassageiro({ status: resposta.status });
    }
    if (!resposta.ok) {
      throw new SupabaseErro(
        `Supabase ${resposta.status} em ${caminho}: ${texto.slice(0, 400)}`,
        resposta.status,
        texto,
      );
    }
    if (texto === '') return null;
    try {
      return JSON.parse(texto);
    } catch {
      return null;
    }
  }

  async select<T>(tabela: string, query: string): Promise<T[]> {
    const dados = await this.#requisicao(`/rest/v1/${tabela}?${query}`, {
      method: 'GET',
      headers: this.#cabecalhos(),
    }, true);
    return Array.isArray(dados) ? (dados as T[]) : [];
  }

  /**
   * Todas as linhas, em páginas. O PostgREST do Supabase devolve no máximo
   * 1.000 linhas por consulta e IGNORA um `limit` maior, em silêncio. Foi isso
   * que fez uma medição de 23/10 ler 1.000 de 1.645 linhas e reportar 65% de
   * descarte onde havia 31%. `query` não deve trazer `limit` nem `offset`, e
   * deve trazer `order`, ou a paginação pode repetir ou pular linhas.
   */
  async selectTodos<T>(tabela: string, query: string, pagina = 1000): Promise<T[]> {
    const saida: T[] = [];
    for (let offset = 0; ; offset += pagina) {
      const lote = await this.select<T>(tabela, `${query}&limit=${pagina}&offset=${offset}`);
      saida.push(...lote);
      if (lote.length < pagina) return saida;
    }
  }

  async insert<T>(
    tabela: string,
    linhas: Array<Record<string, unknown>>,
    opts: OpcoesInsert = {},
  ): Promise<T[]> {
    if (linhas.length === 0) return [];

    const prefer: string[] = [];
    if (opts.mesclarDuplicados) prefer.push('resolution=merge-duplicates');
    else if (opts.ignorarDuplicados) prefer.push('resolution=ignore-duplicates');
    prefer.push(opts.retornar ? 'return=representation' : 'return=minimal');

    const params = opts.conflito ? `?on_conflict=${encodeURIComponent(opts.conflito)}` : '';

    const dados = await this.#requisicao(`/rest/v1/${tabela}${params}`, {
      method: 'POST',
      headers: this.#cabecalhos({ prefer: prefer.join(',') }),
      body: JSON.stringify(linhas),
    }, Boolean(opts.ignorarDuplicados || opts.mesclarDuplicados));
    return Array.isArray(dados) ? (dados as T[]) : [];
  }

  /**
   * PATCH com filtro em `query`. O filtro é obrigatório de propósito: PostgREST
   * sem `where` atualiza a tabela inteira, e um bug aqui reescreveria todo o
   * acervo coletado.
   */
  async update(tabela: string, query: string, campos: Record<string, unknown>): Promise<void> {
    if (query.trim() === '') throw new Error(`update em ${tabela} sem filtro`);
    await this.#requisicao(`/rest/v1/${tabela}?${query}`, {
      method: 'PATCH',
      headers: this.#cabecalhos({ prefer: 'return=minimal' }),
      body: JSON.stringify(campos),
    }, true);
  }

  /**
   * DELETE com filtro em `query`, obrigatório pelo mesmo motivo do `update`:
   * PostgREST sem `where` apaga a tabela inteira, e aqui isso seria o acervo
   * classificado. Só a reclassificação usa este método.
   */
  async remove(tabela: string, query: string): Promise<void> {
    if (query.trim() === '') throw new Error(`delete em ${tabela} sem filtro`);
    await this.#requisicao(`/rest/v1/${tabela}?${query}`, {
      method: 'DELETE',
      headers: this.#cabecalhos({ prefer: 'return=minimal' }),
    }, true);
  }

  async rpc<T>(funcao: string, args: Record<string, unknown>): Promise<T> {
    const dados = await this.#requisicao(`/rest/v1/rpc/${funcao}`, {
      method: 'POST',
      headers: this.#cabecalhos(),
      body: JSON.stringify(args),
    }, false);
    return dados as T;
  }
}

/** PostgREST tem limite de tamanho de URL: consulta os hashes conhecidos em lotes. */
export async function hashesExistentes(
  db: SupabaseRest,
  hashes: string[],
  tamanhoLote = 150,
): Promise<Set<string>> {
  const conhecidos = new Set<string>();

  for (let i = 0; i < hashes.length; i += tamanhoLote) {
    const lote = hashes.slice(i, i + tamanhoLote);
    const lista = lote.map((h) => `"${h}"`).join(',');
    const linhas = await db.select<{ url_hash: string }>(
      'raw_results',
      `select=url_hash&url_hash=in.(${lista})`,
    );
    for (const linha of linhas) conhecidos.add(linha.url_hash);
  }

  log.debug('hashes já conhecidos pelo banco', {
    consultados: hashes.length,
    encontrados: conhecidos.size,
  });
  return conhecidos;
}
