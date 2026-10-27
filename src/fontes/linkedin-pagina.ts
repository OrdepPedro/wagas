/**
 * Data de publicação lida da página pública da vaga do LinkedIn (achado 41).
 *
 * A SERP não serve para isso: `qdr:w` filtra a data do índice, e 23% do que ele
 * devolve já tinha mais de uma semana. A página tem a data, mas só relativa
 * ("Há 5 dias") e sem `JobPosting` — 0 de 30 em 27/10 —, então a precisão é de
 * dia e a origem gravada é `pagina_html`, nunca `metatag`.
 *
 * A data vem do topo da vaga (`posted-time-ago__text`). O `<time datetime>` da
 * página é da lateral de vagas similares (`aside-job-card__listdate`, ~40 por
 * página): ler dali gravaria a data de outra vaga, que é o achado 1 de novo.
 *
 * GET anônimo, sem cookie e sem conta (restrição 2). O robots.txt proíbe; a
 * exceção é decisão do Pedro de 27/10, registrada na restrição 3. Só na coleta.
 */

const UNIDADES: [RegExp, number][] = [
  [/^(minuto|minute)/, 60_000],
  [/^(hora|hour)/, 3_600_000],
  [/^(dia|day)/, 86_400_000],
  [/^(semana|week)/, 7 * 86_400_000],
  [/^(m[eê]s|meses|month)/, 30 * 86_400_000],
  [/^(ano|year)/, 365 * 86_400_000],
];

/** "Há 5 dias", "Há 23 horas", "2 weeks ago" → ISO. Nada reconhecível → null. */
export function dataRelativaDoLinkedin(texto: string, agora: Date): string | null {
  const m = /(\d+)\s+([a-zêç]+)/i.exec(texto.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  const unidade = UNIDADES.find(([re]) => re.test(m[2]!));
  if (!unidade) return null;
  return new Date(agora.getTime() - n * unidade[1]).toISOString();
}

/** O texto de data do topo da vaga, ou null se a página não o tiver. */
export function textoDeDataDaPagina(html: string): string | null {
  const m = /class="posted-time-ago__text[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  const texto = m?.[1]?.replace(/<[^>]+>/g, '').trim();
  return texto ? texto : null;
}

export type LeituraDaPagina =
  | { tipo: 'datada'; dataPublicacao: string; texto: string }
  | { tipo: 'sem_data' }
  | { tipo: 'removida'; status: number }
  | { tipo: 'falhou'; motivo: string };

/**
 * Página caída não é página sem data (trava 4, lição do achado 24): 429, 5xx e
 * erro de rede viram `falhou`, e quem chama não grava nada em cima disso.
 */
export async function lerPaginaDoLinkedin(
  url: string,
  agora: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<LeituraDaPagina> {
  let resposta: Response;
  try {
    resposta = await fetchImpl(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      redirect: 'follow',
    });
  } catch (e) {
    return { tipo: 'falhou', motivo: e instanceof Error ? e.message : String(e) };
  }
  if (resposta.status === 404 || resposta.status === 410) {
    return { tipo: 'removida', status: resposta.status };
  }
  if (!resposta.ok) return { tipo: 'falhou', motivo: `HTTP ${resposta.status}` };

  const html = await resposta.text();
  const texto = textoDeDataDaPagina(html);
  const data = texto ? dataRelativaDoLinkedin(texto, agora) : null;
  if (!texto || !data) return { tipo: 'sem_data' };
  return { tipo: 'datada', dataPublicacao: data, texto };
}
