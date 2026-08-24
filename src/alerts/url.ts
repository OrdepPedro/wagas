/**
 * O Google Alerts nunca entrega a URL de destino direto: embrulha tudo em
 * `https://www.google.com/url?...&url=<destino>&...`.
 *
 * Sem desembrulhar, TODA entrada canonicaliza para o mesmo host (google.com) e
 * a dedup por hash de URL colapsa vagas distintas em uma só — falha silenciosa
 * e destrutiva, do tipo que só aparece quando o feed já está vazio.
 */

const PARAMS_DE_DESTINO = ['url', 'q'];

/** Retorna a URL real, ou `null` se a entrada não for aproveitável. */
export function desembrulharLinkDoGoogle(bruta: string): string | null {
  if (typeof bruta !== 'string' || bruta.trim() === '') return null;

  let url: URL;
  try {
    url = new URL(bruta.trim());
  } catch {
    return null;
  }

  const ehRedirect =
    /(^|\.)google\.[a-z.]+$/.test(url.hostname.toLowerCase()) && /^\/(url|imgres)$/.test(url.pathname);

  if (!ehRedirect) {
    // Já veio direto. Acontece em parte das entradas.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  }

  for (const nome of PARAMS_DE_DESTINO) {
    const destino = url.searchParams.get(nome);
    if (!destino) continue;
    try {
      const alvo = new URL(destino);
      if (alvo.protocol === 'http:' || alvo.protocol === 'https:') return alvo.toString();
    } catch {
      // parâmetro presente mas quebrado: tenta o próximo
    }
  }

  return null;
}
