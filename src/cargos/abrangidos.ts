/**
 * Cargos que a coleta diária cobre — a lista que a landing mostra.
 *
 * Duas origens: a pré-carga fixa e os cargos sugeridos por visitantes
 * (`cargos_sugeridos`, migration 0014). As duas passam pela mesma chave de
 * família que agrupa a fila de demanda, para "Enfermeira" sugerida não aparecer
 * ao lado do "Enfermeiro" da pré-carga.
 */
import { chaveDeFamilia } from '../classificar/familia.ts';

/** Quantos sugeridos a coleta diária visita por noite. O resto espera. */
export const MAX_SUGERIDOS_NA_COLETA = 20;
export const MAX_SUGESTOES_POR_DIA = 3;

/**
 * Normaliza e valida o texto digitado. Devolve o cargo limpo ou o motivo da
 * recusa, em texto pronto para a tela.
 *
 * A regra é de forma, não de conteúdo: só letras e a pontuação que título de
 * cargo usa ("Técnico(a) de Enfermagem", "Front-end", "P&D"). Se é cargo de
 * verdade quem decide é a coleta — sem vaga, não aparece (ver 0014).
 */
export function validarCargo(bruto: string): { cargo: string } | { erro: string } {
  const cargo = bruto.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (cargo.length < 3) return { erro: 'Escreva o nome do cargo.' };
  if (cargo.length > 60) return { erro: 'Nome de cargo longo demais — use até 60 caracteres.' };
  if (!/^[\p{L}][\p{L}\s\-/().&+]*$/u.test(cargo)) {
    return { erro: 'Use só o nome do cargo, sem números nem links.' };
  }
  return { cargo };
}

export function chaveDoCargo(cargo: string): string {
  return chaveDeFamilia(cargo);
}

/** Pré-carga primeiro (ordem fixa), depois os sugeridos; um por família. */
export function juntarCargos(preCarga: readonly string[], sugeridos: readonly string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const cargo of [...preCarga, ...sugeridos]) {
    const chave = chaveDoCargo(cargo);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(cargo);
  }
  return saida;
}

/**
 * Cargos que a coleta diária consulta. Diferente de `juntarCargos`: a
 * pré-carga entra INTEIRA, mesmo com dois cargos da mesma família. "Auxiliar"
 * e "Assistente Administrativo" são uma família na tela, mas duas consultas
 * diferentes na Gupy, que casa por substring. Só os sugeridos são filtrados.
 */
export function cargosDaColeta(preCarga: readonly string[], sugeridos: readonly string[]): string[] {
  const vistos = new Set(preCarga.map(chaveDoCargo));
  const saida = [...preCarga];
  for (const cargo of sugeridos) {
    const chave = chaveDoCargo(cargo);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(cargo);
  }
  return saida;
}

/** A família já está coberta pela pré-carga? Aí a sugestão não precisa entrar. */
export function jaNaPreCarga(cargo: string, preCarga: readonly string[]): string | null {
  const chave = chaveDoCargo(cargo);
  return preCarga.find((c) => chaveDoCargo(c) === chave) ?? null;
}
