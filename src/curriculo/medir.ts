/**
 * Medição do currículo: junta o que o código calcula (A e C) com o que o LLM
 * pontua (B, D, E, F, G, H) e devolve a nota de 0 a 100.
 *
 * Nada aqui guarda o currículo. Ele chega, vira prompt, e a função devolve só o
 * resultado (decisão do Pedro em 28/10: medição efêmera). Quem grava o evento
 * da medição — sem o texto — é a camada web.
 */
import type { Provedor } from '../classificar/llm.ts';
import { interpretarAvaliacao, montarPrompt, SCHEMA_MEDICAO, CRITERIOS_DO_LLM } from './prompt.ts';
import { CRITERIOS, faixa, pontuarFormato, pontuarRequisitos, totalizar } from './rubrica.ts';
import type { Extracao, NotaDeCriterio, ResultadoDaMedicao } from './tipos.ts';

/** Sem texto não há o que o LLM avaliar: a pessoa precisa colar o texto. */
export class CurriculoSemTexto extends Error {
  constructor() {
    super('o arquivo não tem texto selecionável');
    this.name = 'CurriculoSemTexto';
  }
}

export interface EntradaDaMedicao {
  extracao: Extracao;
  cargo: string;
  vaga: string | null;
}

export async function medirCurriculo(entrada: EntradaDaMedicao, provedor: Provedor): Promise<ResultadoDaMedicao> {
  const { extracao, cargo } = entrada;
  const vaga = entrada.vaga?.trim() || null;
  if (extracao.sinais.semTexto) throw new CurriculoSemTexto();

  const formato = pontuarFormato(extracao);
  const avaliacao = interpretarAvaliacao(
    await provedor.julgar(montarPrompt({ curriculo: extracao.texto, cargo, vaga }), SCHEMA_MEDICAO),
  );

  const doLlm: NotaDeCriterio[] = CRITERIOS_DO_LLM.map((id) => ({
    id,
    nome: CRITERIOS[id].nome,
    maximo: CRITERIOS[id].maximo,
    avaliado: true,
    ...avaliacao.criterios[id],
  }));
  const criterios = [formato.criterio, pontuarRequisitos(avaliacao.requisitos), ...doLlm].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const nota = totalizar(criterios);

  return {
    nota,
    faixa: faixa(nota),
    estimada: vaga === null,
    criterios,
    requisitos: avaliacao.requisitos,
    alertas: [...formato.alertas, ...avaliacao.alertas],
    melhorias: avaliacao.melhorias,
    modelo: provedor.nome,
  };
}
