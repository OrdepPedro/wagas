/**
 * Deduplicação.
 *
 * Dois níveis, com propósitos diferentes:
 *
 * 1. `raw_results.url_hash` — mesma URL canônica. Barata e exata. É a que roda
 *    aqui, antes do insert: ~50% do bloco de posts repete o bloco de ATS, e
 *    combos diferentes trazem a mesma vaga.
 *
 * 2. `jobs.dedup_key` = empresa + cargo normalizado. Pega a mesma vaga anunciada
 *    em URLs diferentes (uma na Gupy, outra como post). Decisão de schema que
 *    não dá para adiar; quem preenche é o Passo 3 (classificador).
 *    `chaveDedupVaga` já vive aqui para as duas etapas usarem a mesma regra.
 *
 * Dedup semântica (pgvector) é requisito de lançamento, não refinamento — mas
 * depende do texto extraído da página, que é do Passo 3.
 */

export interface ComHash {
  urlHash: string;
}

export interface ResultadoDedup<T> {
  unicos: T[];
  duplicados: T[];
}

/** Dedup dentro da rodada. Mantém a primeira ocorrência — a de melhor posição na SERP. */
export function dedupPorHash<T extends ComHash>(itens: T[]): ResultadoDedup<T> {
  const vistos = new Set<string>();
  const unicos: T[] = [];
  const duplicados: T[] = [];

  for (const item of itens) {
    if (vistos.has(item.urlHash)) {
      duplicados.push(item);
      continue;
    }
    vistos.add(item.urlHash);
    unicos.push(item);
  }

  return { unicos, duplicados };
}

export interface ResultadoNovos<T> {
  novos: T[];
  jaConhecidos: T[];
}

/**
 * Separa o que o banco já tem. Vale a consulta extra mesmo com a constraint
 * UNIQUE cobrindo: "vagas novas por semana" é a métrica de fluxo do produto, e
 * ela só existe se soubermos quantas eram inéditas nesta rodada.
 */
export function separarNovos<T extends ComHash>(
  itens: T[],
  hashesConhecidos: ReadonlySet<string>,
): ResultadoNovos<T> {
  const novos: T[] = [];
  const jaConhecidos: T[] = [];

  for (const item of itens) {
    if (hashesConhecidos.has(item.urlHash)) jaConhecidos.push(item);
    else novos.push(item);
  }

  return { novos, jaConhecidos };
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Sufixos e prefixos societários que aparecem em uma fonte e não na outra
 * ("Grupo Boticário" no LinkedIn vs. `boticario.gupy.io`).
 * Lista curta de propósito: fundir empresas distintas é pior que perder uma fusão.
 */
const RUIDO_EMPRESA = /\b(ltda\.?|s\.?\/?\s?a\.?|epp|eireli|inc\.?|llc|corp\.?|grupo)\b/g;

/**
 * Cargo normalizado para a chave de dedup.
 * Senioridade é preservada de propósito: "Product Manager Júnior" e
 * "Product Manager Sênior" na mesma empresa são vagas diferentes.
 */
export function normalizarCargo(cargo: string): string {
  return semAcento(cargo)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizarEmpresa(empresa: string): string {
  // O ruído societário sai ANTES da pontuação, senão "S.A." já teria virado "s a".
  return semAcento(empresa)
    .toLowerCase()
    .replace(RUIDO_EMPRESA, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Chave de `jobs.dedup_key`. Usada pelo classificador no Passo 3. */
export function chaveDedupVaga(empresa: string, cargo: string): string {
  return `${normalizarEmpresa(empresa)}|${normalizarCargo(cargo)}`;
}
