/** Item bruto da PSE -> linha de `raw_results`. Sem classificação: só normalização. */
import type { Combinacao, Fonte, OrigemData } from '../tipos.ts';
import type { PseItem } from '../pse/tipos.ts';
import { extrairDataIndexacao, extrairDataPublicacao } from './datas.ts';
import { limparSnippet, limparTitulo } from './texto.ts';
import { canonicalizarUrl, hashUrl } from './url.ts';

export interface ResultadoNormalizado {
  urlHash: string;
  urlCanonica: string;
  urlOriginal: string;
  titulo: string;
  snippet: string;
  fonte: Fonte;
  fonteId: string | null;
  comboId: string;
  cargoBusca: string;
  modeloBusca: string;
  localizacaoBusca: string | null;
  dataPublicacao: string | null;
  dataPublicacaoOrigem: OrigemData;
  dataIndexacao: string | null;
  posicaoSerp: number;
  payload: unknown;
}

export interface ContextoBusca {
  combo: Combinacao;
  /** start da query (1, 11, ...) — com o índice do item vira a posição na SERP. */
  start: number;
  indice: number;
}

/** Retorna `null` quando o item não é aproveitável (sem link, sem título, URL quebrada). */
export function normalizarItem(item: PseItem, ctx: ContextoBusca): ResultadoNormalizado | null {
  const canonica = canonicalizarUrl(item.link ?? '');
  if (!canonica) return null;

  const titulo = limparTitulo(item.title);
  if (titulo === '') return null;

  const snippet = limparSnippet(item.snippet ?? item.htmlSnippet);
  const { data, origem } = extrairDataPublicacao(item, canonica.fonte, snippet);

  return {
    urlHash: hashUrl(canonica.url),
    urlCanonica: canonica.url,
    urlOriginal: item.link ?? '',
    titulo,
    snippet,
    fonte: canonica.fonte,
    // Id do LinkedIn é crescente: serve de proxy de idade quando não há data.
    // A conversão id -> data ainda precisa de duas vagas âncora; não é feita aqui.
    fonteId: canonica.fonteId,
    comboId: ctx.combo.id,
    cargoBusca: ctx.combo.cargo,
    modeloBusca: ctx.combo.modelo,
    localizacaoBusca: ctx.combo.localizacao,
    dataPublicacao: data,
    dataPublicacaoOrigem: origem,
    dataIndexacao: extrairDataIndexacao(item),
    posicaoSerp: ctx.start + ctx.indice,
    payload: item,
  };
}

export function normalizarLote(
  itens: PseItem[],
  ctx: Omit<ContextoBusca, 'indice'>,
): { normalizados: ResultadoNormalizado[]; descartados: number } {
  const normalizados: ResultadoNormalizado[] = [];
  let descartados = 0;

  itens.forEach((item, indice) => {
    const normalizado = normalizarItem(item, { ...ctx, indice });
    if (normalizado) normalizados.push(normalizado);
    else descartados++;
  });

  return { normalizados, descartados };
}

/** Mapeia para os nomes de coluna de `raw_results`. */
export function paraLinha(r: ResultadoNormalizado): Record<string, unknown> {
  return {
    url_hash: r.urlHash,
    url_canonica: r.urlCanonica,
    url_original: r.urlOriginal,
    titulo: r.titulo,
    snippet: r.snippet,
    fonte: r.fonte,
    fonte_id: r.fonteId,
    combo_id: r.comboId,
    cargo_busca: r.cargoBusca,
    modelo_busca: r.modeloBusca,
    localizacao_busca: r.localizacaoBusca,
    data_publicacao: r.dataPublicacao,
    data_publicacao_origem: r.dataPublicacaoOrigem,
    data_indexacao: r.dataIndexacao,
    posicao_serp: r.posicaoSerp,
    payload: r.payload,
  };
}
