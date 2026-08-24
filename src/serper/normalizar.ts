/** Resultado orgânico da Serper -> a mesma linha de `raw_results`. */
import { dataDoSnippetGupy } from '../normalize/datas.ts';
import type { ResultadoNormalizado } from '../normalize/resultado.ts';
import { limparSnippet, limparTitulo } from '../normalize/texto.ts';
import { canonicalizarUrl, hashUrl } from '../normalize/url.ts';
import type { Combinacao } from '../tipos.ts';
import type { ResultadoOrganico } from './cliente.ts';

export interface ContextoSerper {
  combo: Combinacao;
  pagina: number;
  indice: number;
}

export function normalizarOrganico(
  item: ResultadoOrganico,
  ctx: ContextoSerper,
): ResultadoNormalizado | null {
  const canonica = canonicalizarUrl(item.link ?? '');
  if (!canonica) return null;

  const titulo = limparTitulo(item.title);
  if (titulo === '') return null;

  const snippet = limparSnippet(item.snippet);
  const daGupy = canonica.fonte === 'ats_gupy' ? dataDoSnippetGupy(snippet) : null;

  return {
    urlHash: hashUrl(canonica.url),
    urlCanonica: canonica.url,
    urlOriginal: item.link ?? '',
    titulo,
    snippet,
    fonte: canonica.fonte,
    fonteId: canonica.fonteId,
    comboId: ctx.combo.id,
    cargoBusca: ctx.combo.cargo,
    modeloBusca: ctx.combo.modelo,
    localizacaoBusca: ctx.combo.localizacao,
    dataPublicacao: daGupy,
    dataPublicacaoOrigem: daGupy ? 'gupy_snippet' : 'desconhecida',
    // `item.date` vem como texto do Google ("há 3 dias"); não é data confiável
    // e vira trabalho do classificador, não da normalização.
    dataIndexacao: null,
    // `position` da Serper é a posição na página; somamos o offset da página.
    posicaoSerp: (ctx.pagina - 1) * 10 + (item.position ?? ctx.indice + 1),
    payload: item,
  };
}

export function normalizarPaginaSerper(
  organicos: ResultadoOrganico[],
  ctx: Omit<ContextoSerper, 'indice'>,
): { normalizados: ResultadoNormalizado[]; descartados: number } {
  const normalizados: ResultadoNormalizado[] = [];
  let descartados = 0;

  organicos.forEach((item, indice) => {
    const r = normalizarOrganico(item, { ...ctx, indice });
    if (r) normalizados.push(r);
    else descartados++;
  });

  return { normalizados, descartados };
}
