/**
 * A regra do teto de buscas, sem Next nem Supabase. Mora em `src/` porque a
 * suíte da raiz a testa e o `web/` a importa — mesma convenção de `consulta.ts`.
 */

/** Um par cargo × cidade, na mesma forma em que `buscas` grava. */
export function chaveDoPar(cargo: string, cidadeSlug: string): string {
  return `${cargo.trim().toLowerCase()}|${cidadeSlug}`;
}

export interface LinhaDeBusca {
  cargo: string;
  cidade: string;
  cidade_slug: string;
  criado_em: string;
}

export interface Vaga {
  chave: string;
  cargo: string;
  cidade: string;
  inicio: Date;
  /** Quando a vaga libera. `null` = só na virada do dia (usuário com e-mail). */
  liberaEm: Date | null;
}

export interface Ocupacao {
  /** Vagas ativas agora, a da busca atual incluída quando ela ocupou uma. */
  vagas: Vaga[];
  estourou: boolean;
}

/**
 * Quais pares ocupam vaga no teto agora, e se a busca atual cabe.
 *
 * Cada par novo ocupa uma vaga por `duracaoMs` a partir da PRIMEIRA busca dele;
 * voltar ao mesmo par dentro desse prazo não gasta nada nem estende o prazo.
 * Visitante: 2 vagas de 7 dias. Com e-mail: 10 vagas que valem até a virada do
 * dia (`duracaoMs = Infinity`, com as linhas já filtradas pelo dia).
 *
 * Simula em ordem, e não só conta pares distintos, por causa de um furo: a
 * busca negada TAMBÉM é gravada em `buscas` (é telemetria da demanda). Contando
 * pares, a 3ª busca negada virava "par já buscado" na visita seguinte e
 * passava a disparar coleta. Aqui uma busca negada nunca ocupa vaga.
 */
export function ocuparVagas(
  linhas: readonly LinhaDeBusca[],
  atual: { cargo: string; cidade: string; cidadeSlug: string },
  teto: number,
  duracaoMs: number,
  agora: Date,
): Ocupacao {
  const vagas = new Map<string, Vaga>();
  const ativasEm = (t: number) =>
    [...vagas.values()].filter((v) => v.liberaEm === null || v.liberaEm.getTime() > t);

  const tentar = (chave: string, cargo: string, cidade: string, t: number): boolean => {
    const existente = vagas.get(chave);
    if (existente && (existente.liberaEm === null || existente.liberaEm.getTime() > t)) return true;
    if (ativasEm(t).filter((v) => v.chave !== chave).length >= teto) return false;
    vagas.set(chave, {
      chave,
      cargo,
      cidade,
      inicio: new Date(t),
      liberaEm: Number.isFinite(duracaoMs) ? new Date(t + duracaoMs) : null,
    });
    return true;
  };

  const ordenadas = [...linhas].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  for (const l of ordenadas) {
    tentar(chaveDoPar(l.cargo, l.cidade_slug), l.cargo.trim(), l.cidade.trim(), Date.parse(l.criado_em));
  }

  const coube = tentar(
    chaveDoPar(atual.cargo, atual.cidadeSlug),
    atual.cargo.trim(),
    atual.cidade.trim(),
    agora.getTime(),
  );
  return {
    vagas: ativasEm(agora.getTime()).sort((a, b) => a.inicio.getTime() - b.inicio.getTime()),
    estourou: !coube,
  };
}
