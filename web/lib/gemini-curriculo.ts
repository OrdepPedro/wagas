/**
 * O Gemini do medidor e do estruturador de currículo: um modelo principal e um
 * de reserva, do mesmo provedor e nos mesmos termos de uso.
 *
 * A reserva existe por causa de 11/11: o `gemini-3.5-flash-lite` respondeu 503
 * ("This model is currently experiencing high demand") em 5 de 9 chamadas, e
 * três tentativas com backoff não bastaram. No mesmo momento o
 * `gemini-3.1-flash-lite` respondeu 4 de 4, em ~3,4 s, com saída que passa na
 * validação do medidor. A sobrecarga é do modelo, não do Google inteiro.
 *
 * A reserva é Gemini de propósito: cair para o Groq mudaria para onde vai o
 * currículo e disputaria a cota da adaptação, que é a mesma chave.
 */
import { CadeiaDeProvedores, ProvedorGemini, type Provedor } from '../../src/classificar/llm.ts';

const PRINCIPAL = 'gemini-3.5-flash-lite';
const RESERVA = 'gemini-3.1-flash-lite';

export function provedorDeCurriculo(chave: string): Provedor {
  const principal = process.env['GEMINI_MODELO']?.trim() || PRINCIPAL;
  const reserva = process.env['GEMINI_MODELO_RESERVA']?.trim() || RESERVA;
  const modelos = reserva === principal ? [principal] : [principal, reserva];

  // Duas tentativas por modelo, com 3 s de espera: o pior caso de quatro
  // chamadas cabe no maxDuration de 120 s das páginas.
  return new CadeiaDeProvedores(
    modelos.map((modelo) => new ProvedorGemini({ chave, modelo, intervaloMs: 0, tentativas: 2, backoffBaseMs: 3_000 })),
  );
}
