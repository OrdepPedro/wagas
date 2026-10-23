/**
 * A regra do teto diário, sem Next nem Supabase, para a suíte da raiz testar.
 */

/** Um par cargo × cidade, na mesma forma em que `buscas` grava. */
export function chaveDoPar(cargo: string, cidadeSlug: string): string {
  return `${cargo.trim().toLowerCase()}|${cidadeSlug}`;
}

/**
 * Quanto do teto as linhas de hoje consumiram, e se a busca atual estoura.
 *
 * Conta PARES distintos, não linhas. A versão anterior contava linhas, e
 * `buscas` só colapsa repetição de menos de um minuto — então quem voltava ao
 * mesmo feed três vezes numa manhã esgotava o teto do visitante sem trocar de
 * cargo. O que custa trabalho é par novo; o mesmo par já está no cache.
 *
 * Pela mesma razão, um par que já foi buscado hoje nunca estoura: refazê-lo
 * não dispara nada que a primeira vez não tenha disparado.
 */
export function contarPares(
  linhas: readonly { cargo: string; cidade_slug: string }[],
  parAtual: string,
  teto: number,
): { usadas: number; estourou: boolean } {
  const pares = new Set(linhas.map((l) => chaveDoPar(l.cargo, l.cidade_slug)));
  const usadas = pares.size;
  return { usadas, estourou: !pares.has(parAtual) && usadas >= teto };
}
