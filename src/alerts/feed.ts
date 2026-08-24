/**
 * Leitor de feed RSS do Google Alerts.
 *
 * Substitui a PSE como fonte: a Custom Search JSON API foi fechada a novos
 * projetos em 2025 e é desligada em 01/01/2027. O Alerts entrega Atom, de
 * graça, sem chave e sem cota diária declarada.
 *
 * Diferença conceitual que muda a medição: a PSE consultava o ÍNDICE (estoque
 * acumulado); o Alerts entrega FLUXO (o que apareceu desde a criação do
 * alerta). Para a métrica que importa — vagas novas por semana por segmento —
 * fluxo é o que se queria medir desde o começo.
 */
import { limparTexto } from '../normalize/texto.ts';
import { desembrulharLinkDoGoogle } from './url.ts';

export interface EntradaAlerta {
  /** id da entrada no feed — estável, serve de chave de idempotência do Alerts. */
  id: string;
  titulo: string;
  /** URL real, já fora do redirect do Google. */
  link: string;
  /** Link como veio no feed, guardado para auditoria. */
  linkOriginal: string;
  resumo: string;
  /** Quando o Alerts detectou. É o melhor proxy de data de indexação que temos. */
  publicadoEm: string | null;
}

function primeiroGrupo(re: RegExp, bloco: string): string | null {
  const m = re.exec(bloco);
  return m?.[1] ?? null;
}

/**
 * Parser de Atom mínimo, por regex.
 *
 * Justificativa: o feed do Alerts tem forma fixa e conhecida, e o projeto não
 * tem dependência de runtime. Um parser XML completo aqui pagaria por uma
 * generalidade que nenhum outro consumidor vai usar. Se algum dia o coletor
 * ler feed de terceiro com forma arbitrária, aí troca.
 */
export function parsearFeed(xml: string): EntradaAlerta[] {
  const entradas: EntradaAlerta[] = [];

  for (const m of xml.matchAll(/<entry\b[^>]*>(.*?)<\/entry>/gs)) {
    const bloco = m[1];
    if (!bloco) continue;

    const href = primeiroGrupo(/<link\b[^>]*href=["']([^"']+)["']/s, bloco);
    if (!href) continue;

    // No Atom o & vem escapado como &amp; dentro do atributo.
    const linkOriginal = href.replace(/&amp;/g, '&');
    const link = desembrulharLinkDoGoogle(linkOriginal);
    if (!link) continue;

    entradas.push({
      id: primeiroGrupo(/<id>(.*?)<\/id>/s, bloco) ?? linkOriginal,
      titulo: limparTexto(primeiroGrupo(/<title\b[^>]*>(.*?)<\/title>/s, bloco)),
      link,
      linkOriginal,
      resumo: limparTexto(primeiroGrupo(/<content\b[^>]*>(.*?)<\/content>/s, bloco)),
      publicadoEm: normalizarData(primeiroGrupo(/<published>(.*?)<\/published>/s, bloco)),
    });
  }

  return entradas;
}

function normalizarData(bruto: string | null): string | null {
  if (!bruto) return null;
  const ms = Date.parse(bruto.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export class FeedErro extends Error {
  status: number;
  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.name = 'FeedErro';
    this.status = status;
  }
}

export async function buscarFeed(url: string, fetchImpl: typeof fetch = fetch): Promise<EntradaAlerta[]> {
  const resposta = await fetchImpl(url, {
    headers: { accept: 'application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resposta.ok) {
    throw new FeedErro(`feed respondeu ${resposta.status}`, resposta.status);
  }

  return parsearFeed(await resposta.text());
}
