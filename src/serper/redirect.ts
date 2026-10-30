/**
 * Desde out/2026 a Serper devolve parte dos links como redirect do Google
 * (`https://www.google.com/goto?url=<opaco>`), não como a URL do resultado.
 * Na rodada de 30/10, 157 de 242 links vieram assim e caíram como
 * `fonte = desconhecida`: sem canonicalização, sem `fonte_id`, sem dedup.
 *
 * O redirect resolve com uma requisição ao próprio Google, que responde 302
 * com a URL real no `Location`. Não segue o redirect: o destino (LinkedIn,
 * Gupy) não é tocado aqui. Só roda na coleta, nunca no request do usuário.
 */

export function ehRedirectGoogle(link: string): boolean {
  try {
    const url = new URL(link);
    return /^(www\.)?google\.[a-z.]+$/i.test(url.hostname) && url.pathname === '/goto';
  } catch {
    return false;
  }
}

/**
 * URL de destino do redirect, ou `null` se o Google não devolveu 3xx com
 * `Location` absoluto. Falha de rede também é `null`: o chamador mantém o link
 * original, que cai como `desconhecida` — visível, em vez de inventado.
 */
export async function resolverRedirectGoogle(
  link: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const resposta = await fetchImpl(link, { method: 'GET', redirect: 'manual' });
    if (resposta.status < 300 || resposta.status >= 400) return null;
    const destino = resposta.headers.get('location');
    if (!destino || !/^https?:\/\//i.test(destino)) return null;
    return ehRedirectGoogle(destino) ? null : destino;
  } catch {
    return null;
  }
}
