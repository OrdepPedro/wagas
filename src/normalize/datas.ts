/**
 * Datas.
 *
 * `data_publicacao` (quando a vaga foi anunciada) e `data_coleta` (quando o
 * coletor viu) são colunas separadas — guardar só a segunda perde o frescor
 * para sempre. Junto com a data guardamos a ORIGEM dela, porque a qualidade do
 * sinal varia muito por fonte:
 *
 *   ats_gupy       → snippet traz "Publicada em DD/MM/AAAA". Melhor sinal.
 *   qualquer fonte → metatag article:published_time / jobposting.dateposted.
 *   linkedin_post  → normalmente nada. Fica null; o dateRestrict da busca é a
 *                    única garantia de frescor.
 *
 * A API da PSE não expõe a data de crawl. `data_indexacao` é o melhor
 * equivalente disponível — a última modificação declarada pela própria página.
 */
import type { Fonte, OrigemData } from '../tipos.ts';
import type { PseItem } from '../pse/tipos.ts';

export interface DataExtraida {
  data: string | null;
  origem: OrigemData;
}

const CAMPOS_PUBLICACAO = [
  'article:published_time',
  'og:article:published_time',
  'datepublished',
  'date',
];

const CAMPOS_MODIFICACAO = ['article:modified_time', 'og:updated_time', 'lastmod'];

function metatags(item: PseItem): Record<string, string> {
  const todas = item.pagemap?.metatags ?? [];
  const unida: Record<string, string> = {};
  for (const bloco of todas) {
    for (const [chave, valor] of Object.entries(bloco)) {
      const k = chave.toLowerCase();
      if (unida[k] === undefined && typeof valor === 'string') unida[k] = valor;
    }
  }
  return unida;
}

function jobPosting(item: PseItem): Record<string, string> {
  const bruto = item.pagemap?.['jobposting'];
  if (!Array.isArray(bruto) || bruto.length === 0) return {};
  const primeiro: unknown = bruto[0];
  if (!primeiro || typeof primeiro !== 'object') return {};
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(primeiro as Record<string, unknown>)) {
    if (typeof valor === 'string') saida[chave.toLowerCase()] = valor;
  }
  return saida;
}

/** Converte para ISO 8601 UTC. Retorna null para lixo ou data absurda. */
export function paraIso(bruto: string | undefined): string | null {
  if (!bruto) return null;
  const ms = Date.parse(bruto);
  if (!Number.isFinite(ms)) return null;
  const ano = new Date(ms).getUTCFullYear();
  if (ano < 2015 || ano > 2100) return null;
  return new Date(ms).toISOString();
}

/**
 * "Publicada em 12/08/2026" → 2026-08-12T00:00:00-03:00 (meia-noite de Brasília).
 *
 * Os dois-pontos são opcionais e não são detalhe: a Gupy escreve
 * "Publicada em: 21/08/2026", e a versão anterior desta regex exigia `\s+`
 * depois de "em". Resultado medido em produção — 9 dos 57 snippets da Gupy
 * traziam data e os 9 foram perdidos, deixando `data_publicacao` null em 197
 * de 197 linhas. Era o único sinal de data estruturado que o produto tinha.
 */
export function dataDoSnippetGupy(snippet: string): string | null {
  const m = /publicad[ao]\s+em:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(snippet);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  if (!dia || !mes || !ano) return null;
  const d = Number(dia);
  const mm = Number(mes);
  if (d < 1 || d > 31 || mm < 1 || mm > 12) return null;
  const iso = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T00:00:00-03:00`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function extrairDataPublicacao(
  item: PseItem,
  fonte: Fonte,
  snippetLimpo: string,
): DataExtraida {
  if (fonte === 'ats_gupy') {
    const daGupy = dataDoSnippetGupy(snippetLimpo);
    if (daGupy) return { data: daGupy, origem: 'gupy_snippet' };
  }

  const vaga = jobPosting(item);
  const daVaga = paraIso(vaga['dateposted'] ?? vaga['dateposted_iso']);
  if (daVaga) return { data: daVaga, origem: 'metatag' };

  const tags = metatags(item);
  for (const campo of CAMPOS_PUBLICACAO) {
    const valor = paraIso(tags[campo]);
    if (valor) return { data: valor, origem: 'metatag' };
  }

  return { data: null, origem: 'desconhecida' };
}

/**
 * Aproximação de "quando o índice viu esta página pela última vez".
 * A PSE não devolve data de crawl; usamos a última modificação declarada.
 */
export function extrairDataIndexacao(item: PseItem): string | null {
  const tags = metatags(item);
  for (const campo of CAMPOS_MODIFICACAO) {
    const valor = paraIso(tags[campo]);
    if (valor) return valor;
  }
  return null;
}
