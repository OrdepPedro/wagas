/** Limpeza de texto vindo da PSE (título e snippet chegam com entidades HTML). */

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

function umaPassada(texto: string): string {
  return texto
    .replace(/&#(\d+);/g, (_, cod: string) => String.fromCodePoint(Number(cod)))
    .replace(/&#x([0-9a-f]+);/gi, (_, cod: string) => String.fromCodePoint(parseInt(cod, 16)))
    .replace(/&([a-z]+);/gi, (todo, nome: string) => ENTIDADES[nome.toLowerCase()] ?? todo);
}

/**
 * O Google entrega título com DUPLA codificação: um "&" do texto original vira
 * `&amp;amp;`, e uma passada só deixaria `&amp;` visível para o usuário.
 * Repete até estabilizar, com teto de 3 — sem teto, um texto que contenha
 * literalmente "&amp;" entraria em laço.
 */
export function decodificarEntidades(texto: string): string {
  let atual = texto;
  for (let i = 0; i < 3; i++) {
    const proximo = umaPassada(atual);
    if (proximo === atual) break;
    atual = proximo;
  }
  return atual;
}

export function limparTexto(bruto: string | undefined | null): string {
  if (!bruto) return '';
  return decodificarEntidades(bruto)
    .replace(/<[^>]*>/g, '')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

const SUFIXOS = [/\s*[|\-–—]\s*LinkedIn\s*$/i, /\s*[|\-–—]\s*Gupy\s*$/i];

export function limparTitulo(bruto: string | undefined | null): string {
  let titulo = limparTexto(bruto);
  for (const sufixo of SUFIXOS) titulo = titulo.replace(sufixo, '').trim();
  return titulo;
}

/**
 * O snippet da PSE é contaminado: a página de uma vaga do LinkedIn traz a barra
 * lateral de "vagas similares", então o snippet pode descrever outra vaga.
 * Guardamos como sinal fraco — a extração de verdade é da página, no Passo 3.
 */
export function limparSnippet(bruto: string | undefined | null): string {
  return limparTexto(bruto);
}
