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

export class SupabaseRest {
  #url: string;
  #key: string;
  #fetch: typeof fetch;

  constructor(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch) {
    this.#url = url.replace(/\/+$/, '');
    this.#key = serviceKey;
    this.#fetch = fetchImpl;
  }

  #cabecalhos(extras: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.#key,
      authorization: `Bearer ${this.#key}`,
      'content-type': 'application/json',
      ...extras,
    };
  }

  async #requisicao(caminho: string, init: RequestInit): Promise<unknown> {
    const resposta = await this.#fetch(`${this.#url}${caminho}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });

    const texto = await resposta.text();
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
    });
    return Array.isArray(dados) ? (dados as T[]) : [];
  }

  async insert<T>(
    tabela: string,
    linhas: Array<Record<string, unknown>>,
    opts: OpcoesInsert = {},
  ): Promise<T[]> {
    if (linhas.length === 0) return [];

    const prefer: string[] = [];
    if (opts.ignorarDuplicados) prefer.push('resolution=ignore-duplicates');
    prefer.push(opts.retornar ? 'return=representation' : 'return=minimal');

    const params = opts.conflito ? `?on_conflict=${encodeURIComponent(opts.conflito)}` : '';

    const dados = await this.#requisicao(`/rest/v1/${tabela}${params}`, {
      method: 'POST',
      headers: this.#cabecalhos({ prefer: prefer.join(',') }),
      body: JSON.stringify(linhas),
    });
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
    });
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
    });
  }

  async rpc<T>(funcao: string, args: Record<string, unknown>): Promise<T> {
    const dados = await this.#requisicao(`/rest/v1/rpc/${funcao}`, {
      method: 'POST',
      headers: this.#cabecalhos(),
      body: JSON.stringify(args),
    });
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
