/**
 * Harness de avaliação.
 *
 * O classificador sem harness é opinião: dá para olhar dez linhas do log e
 * achar que está bom. O que decide se o Passo 3 pode ir para o feed é
 * **precisão e recall medidos sobre casos rotulados**, e o custo de cada
 * estágio separado — não a impressão de que "pareceu certo".
 *
 * A assimetria que o relatório precisa deixar visível:
 *
 *   FALSO NEGATIVO (vaga boa descartada) é invisível e irreversível. O usuário
 *   não sabe o que não viu, e o item já foi marcado como processado.
 *
 *   FALSO POSITIVO (lixo no feed) é visível e o usuário perdoa um ou dois.
 *
 *   Por isso RECALL manda, e ele é reportado por estágio: o recall do
 *   pré-filtro é o TETO do recall do produto inteiro — o LLM não recupera o que
 *   o pré-filtro já cortou.
 *
 * Este módulo só calcula. Quem lê arquivo e imprime é `scripts/harness.ts`.
 */
import { prefiltrar } from './prefiltro.ts';
import type { Candidato, Decisao } from './tipos.ts';

export type Rotulo = 'relevante' | 'irrelevante' | 'indeterminado';

export interface CasoRotulado {
  id: string;
  origem: string;
  cargoBusca: string;
  cidadeBusca: string;
  recorte: string;
  fonte: string;
  url: string;
  titulo: string;
  snippet: string;
  rotulo: Rotulo;
  /** vaga_da_familia | vaga_adjacente | pagina_de_listagem | nao_e_vaga | cargo_de_outra_familia */
  classe: string;
  nota: string;
}

export function paraCandidato(caso: CasoRotulado): Candidato {
  return {
    id: null,
    fonte: caso.fonte as Candidato['fonte'],
    fonteId: null,
    urlCanonica: caso.url,
    titulo: caso.titulo,
    snippet: caso.snippet,
    cargoBusca: caso.cargoBusca,
    localizacaoBusca: caso.cidadeBusca,
    // Sempre null: o golden set não guarda data, e a regra de janela é de
    // frescor, não de relevância. Deixar uma data aqui faria a mesma medição
    // dar resultado diferente conforme o dia em que rodasse.
    dataPublicacao: null,
  };
}

export interface Metricas {
  positivosVerdadeiros: number;
  falsosPositivos: number;
  falsosNegativos: number;
  negativosVerdadeiros: number;
  /** Casos que nem chegaram a um veredito: erro de infraestrutura. */
  indefinidos: number;
  precisao: number | null;
  recall: number | null;
  f1: number | null;
}

/** `previsto`: true = o pipeline deixaria isso chegar no feed. `null` = não decidiu. */
export interface Avaliado {
  caso: CasoRotulado;
  previsto: boolean | null;
  motivo: string;
  detalhe: string;
  estagio: string;
}

export function medir(avaliados: Avaliado[]): Metricas {
  const m: Metricas = {
    positivosVerdadeiros: 0,
    falsosPositivos: 0,
    falsosNegativos: 0,
    negativosVerdadeiros: 0,
    indefinidos: 0,
    precisao: null,
    recall: null,
    f1: null,
  };

  for (const a of avaliados) {
    // Indeterminado não entra na conta: rotular no chute inventaria a métrica.
    // Quantos são fica no relatório, como cobertura que falta.
    if (a.caso.rotulo === 'indeterminado') continue;
    if (a.previsto === null) {
      m.indefinidos++;
      continue;
    }

    const relevante = a.caso.rotulo === 'relevante';
    if (a.previsto && relevante) m.positivosVerdadeiros++;
    else if (a.previsto && !relevante) m.falsosPositivos++;
    else if (!a.previsto && relevante) m.falsosNegativos++;
    else m.negativosVerdadeiros++;
  }

  const previstosPositivos = m.positivosVerdadeiros + m.falsosPositivos;
  const positivosReais = m.positivosVerdadeiros + m.falsosNegativos;

  m.precisao = previstosPositivos > 0 ? m.positivosVerdadeiros / previstosPositivos : null;
  m.recall = positivosReais > 0 ? m.positivosVerdadeiros / positivosReais : null;
  m.f1 =
    m.precisao !== null && m.recall !== null && m.precisao + m.recall > 0
      ? (2 * m.precisao * m.recall) / (m.precisao + m.recall)
      : null;

  return m;
}

/** Avaliação do pré-filtro isolado. Não custa nada e não precisa de chave. */
export function avaliarPrefiltro(casos: CasoRotulado[]): Avaliado[] {
  return casos.map((caso) => {
    const { passa, motivo, detalhe } = prefiltrar(paraCandidato(caso));
    return {
      caso,
      previsto: passa,
      motivo: motivo ?? 'passou',
      detalhe,
      estagio: 'prefiltro',
    };
  });
}

/** Avaliação do pipeline completo, a partir das decisões já tomadas. */
export function avaliarDecisoes(casos: CasoRotulado[], decisoes: Decisao[]): Avaliado[] {
  return casos.map((caso, i) => {
    const d = decisoes[i];
    if (!d) return { caso, previsto: null, motivo: 'sem decisão', detalhe: '', estagio: '-' };
    return {
      caso,
      previsto: d.veredito === 'erro' ? null : d.veredito === 'aprovado',
      motivo: d.motivo ?? 'aprovado',
      detalhe: d.detalhe,
      estagio: d.estagio,
    };
  });
}

/** Agrupa por uma chave do caso (fonte, cargo...) e mede cada grupo. */
export function medirPor(
  avaliados: Avaliado[],
  chave: (caso: CasoRotulado) => string,
): Map<string, Metricas> {
  const grupos = new Map<string, Avaliado[]>();
  for (const a of avaliados) {
    const k = chave(a.caso);
    const lista = grupos.get(k);
    if (lista) lista.push(a);
    else grupos.set(k, [a]);
  }

  const saida = new Map<string, Metricas>();
  for (const [k, lista] of [...grupos].sort(([a], [b]) => (a < b ? -1 : 1))) {
    saida.set(k, medir(lista));
  }
  return saida;
}

/** Os casos que o pipeline errou, do mais caro para o mais barato de errar. */
export function falhas(avaliados: Avaliado[]): { falsosNegativos: Avaliado[]; falsosPositivos: Avaliado[] } {
  const relevantes = (a: Avaliado) => a.caso.rotulo === 'relevante';
  const irrelevantes = (a: Avaliado) => a.caso.rotulo === 'irrelevante';

  return {
    falsosNegativos: avaliados.filter((a) => relevantes(a) && a.previsto === false),
    falsosPositivos: avaliados.filter((a) => irrelevantes(a) && a.previsto === true),
  };
}
