import test from 'node:test';
import assert from 'node:assert/strict';
import { ocuparVagas, type LinhaDeBusca } from '../web/lib/pares-do-dia.ts';

/**
 * O teto ocupa VAGAS por par cargo × cidade, não conta linhas de `buscas`.
 * Visitante: 2 vagas de 7 dias. Com e-mail: 10 vagas que valem até a virada do
 * dia (as linhas chegam já filtradas pelo dia, e a duração é infinita).
 */

const DIA = 24 * 60 * 60 * 1000;
const SEMANA = 7 * DIA;
const T0 = Date.parse('2026-10-01T12:00:00Z');

const em = (dias: number) => new Date(T0 + dias * DIA);
const linha = (cargo: string, cidade: string, dias: number): LinhaDeBusca => ({
  cargo,
  cidade,
  cidade_slug: cidade.toLowerCase().replace(/\s+/g, '-'),
  criado_em: em(dias).toISOString(),
});
const busca = (cargo: string, cidade: string) => ({
  cargo,
  cidade,
  cidadeSlug: cidade.toLowerCase().replace(/\s+/g, '-'),
});

test('a primeira busca já ocupa uma vaga, antes de ser gravada', () => {
  const r = ocuparVagas([], busca('Vendedor', 'BH'), 2, SEMANA, em(0));
  assert.equal(r.estourou, false);
  assert.equal(r.vagas.length, 1);
  assert.equal(r.vagas[0]!.liberaEm!.getTime(), em(7).getTime());
});

test('voltar a uma busca salva não gasta nada, nem estende o prazo', () => {
  const hist = [linha('Vendedor', 'BH', 0), linha('Vendedor', 'BH', 2), linha('vendedor ', 'BH', 5)];
  const r = ocuparVagas(hist, busca('Vendedor', 'BH'), 2, SEMANA, em(6));
  assert.equal(r.estourou, false);
  assert.equal(r.vagas.length, 1);
  assert.equal(r.vagas[0]!.liberaEm!.getTime(), em(7).getTime());
});

test('terceira busca nova do visitante estoura, e a busca salva continua valendo', () => {
  const hist = [linha('A', 'SP', 0), linha('B', 'SP', 1)];
  assert.equal(ocuparVagas(hist, busca('C', 'SP'), 2, SEMANA, em(2)).estourou, true);
  assert.equal(ocuparVagas(hist, busca('A', 'SP'), 2, SEMANA, em(2)).estourou, false);
});

test('a busca negada nunca ocupa vaga, mesmo gravada em buscas', () => {
  // C foi negada no dia 2, mas a linha existe (telemetria). No dia 3 ela
  // continua negada — antes, virava "par já buscado" e disparava coleta.
  const hist = [linha('A', 'SP', 0), linha('B', 'SP', 1), linha('C', 'SP', 2)];
  const r = ocuparVagas(hist, busca('C', 'SP'), 2, SEMANA, em(3));
  assert.equal(r.estourou, true);
  assert.deepEqual(r.vagas.map((v) => v.cargo), ['A', 'B']);
});

test('passados 7 dias, a vaga libera para uma busca nova', () => {
  const hist = [linha('A', 'SP', 0), linha('B', 'SP', 1)];
  const r = ocuparVagas(hist, busca('C', 'SP'), 2, SEMANA, em(7.5));
  assert.equal(r.estourou, false);
  assert.deepEqual(r.vagas.map((v) => v.cargo), ['B', 'C']);
});

test('busca vencida refeita abre uma vaga nova, com prazo novo', () => {
  const r = ocuparVagas([linha('A', 'SP', 0)], busca('A', 'SP'), 2, SEMANA, em(8));
  assert.equal(r.vagas[0]!.liberaEm!.getTime(), em(15).getTime());
});

test('mesmo cargo em outra cidade é outra busca', () => {
  assert.equal(ocuparVagas([linha('A', 'SP', 0)], busca('A', 'BH'), 2, SEMANA, em(1)).vagas.length, 2);
});

test('com e-mail: vagas sem prazo, teto do dia', () => {
  const hoje = Array.from({ length: 10 }, (_, i) => linha(`C${i}`, 'SP', 0));
  const r = ocuparVagas(hoje, busca('C11', 'SP'), 10, Infinity, em(0.5));
  assert.equal(r.estourou, true);
  assert.equal(r.vagas.every((v) => v.liberaEm === null), true);
  assert.equal(ocuparVagas(hoje, busca('C3', 'SP'), 10, Infinity, em(0.5)).estourou, false);
});
