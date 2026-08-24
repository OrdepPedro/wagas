/** Entrada de feed do Alerts -> a mesma linha de `raw_results` que a PSE produzia. */
import type { Alerta } from '../config/alertas.ts';
import { canonicalizarUrl, hashUrl } from '../normalize/url.ts';
import { limparTitulo } from '../normalize/texto.ts';
import type { ResultadoNormalizado } from '../normalize/resultado.ts';
import { dataDoSnippetGupy } from '../normalize/datas.ts';
import type { EntradaAlerta } from './feed.ts';

export function normalizarEntrada(
  entrada: EntradaAlerta,
  alerta: Alerta,
  posicao: number,
): ResultadoNormalizado | null {
  const canonica = canonicalizarUrl(entrada.link);
  if (!canonica) return null;

  const titulo = limparTitulo(entrada.titulo);
  if (titulo === '') return null;

  // A Gupy continua sendo a única fonte com data explícita no texto.
  const daGupy = canonica.fonte === 'ats_gupy' ? dataDoSnippetGupy(entrada.resumo) : null;

  return {
    urlHash: hashUrl(canonica.url),
    urlCanonica: canonica.url,
    urlOriginal: entrada.link,
    titulo,
    snippet: entrada.resumo,
    fonte: canonica.fonte,
    fonteId: canonica.fonteId,
    comboId: alerta.id,
    cargoBusca: alerta.cargo,
    modeloBusca: alerta.modelo,
    localizacaoBusca: alerta.localizacao,
    dataPublicacao: daGupy,
    dataPublicacaoOrigem: daGupy ? 'gupy_snippet' : 'desconhecida',
    // `published` do feed é quando o Alerts detectou: o melhor proxy de
    // indexação que já tivemos. A PSE não dava nada equivalente.
    dataIndexacao: entrada.publicadoEm,
    posicaoSerp: posicao,
    payload: entrada,
  };
}

export function normalizarFeed(
  entradas: EntradaAlerta[],
  alerta: Alerta,
): { normalizados: ResultadoNormalizado[]; descartados: number } {
  const normalizados: ResultadoNormalizado[] = [];
  let descartados = 0;

  entradas.forEach((entrada, i) => {
    const r = normalizarEntrada(entrada, alerta, i + 1);
    if (r) normalizados.push(r);
    else descartados++;
  });

  return { normalizados, descartados };
}
