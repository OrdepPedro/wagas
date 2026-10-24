import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirEncerramentos, type ConsultaDoDia, type VagaVerificavel } from '../src/coleta/encerramento.ts';

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date('2026-10-24T12:00:00Z');
const haDias = (d: number) => new Date(AGORA.getTime() - d * DIA).toISOString();

const vaga = (id: number, extra: Partial<VagaVerificavel> = {}): VagaVerificavel => ({
  id,
  fonteId: `g${id}`,
  cargoBusca: 'Vendedor',
  cidadeBusca: 'Belo Horizonte',
  soRemoto: false,
  dataPublicacao: haDias(2),
  encerradaEm: null,
  ...extra,
});
const consulta = (ids: string[], extra: Partial<ConsultaDoDia> = {}): ConsultaDoDia => ({
  cargo: 'Vendedor',
  cidade: 'Belo Horizonte',
  soRemoto: false,
  completa: true,
  idsVistos: ids,
  ...extra,
});

test('a vaga que a própria consulta deixou de listar é encerrada', () => {
  const r = decidirEncerramentos([vaga(1), vaga(2)], [consulta(['g1'])], AGORA);
  assert.deepEqual(r.encerrar, [2]);
});

test('consulta incompleta não encerra nada', () => {
  const r = decidirEncerramentos([vaga(1), vaga(2)], [consulta(['g1'], { completa: false })], AGORA);
  assert.deepEqual(r.encerrar, []);
});

test('consulta que não rodou hoje não encerra nada', () => {
  const r = decidirEncerramentos([vaga(1)], [consulta([], { cargo: 'Enfermeiro' })], AGORA);
  assert.deepEqual(r.encerrar, []);
});

test('vista em qualquer outra consulta do dia, a vaga está aberta', () => {
  const r = decidirEncerramentos(
    [vaga(1), vaga(2)],
    [consulta(['g1']), consulta(['g2'], { cidade: null, soRemoto: true })],
    AGORA,
  );
  assert.deepEqual(r.encerrar, []);
});

test('perto do fim da janela, sumir não é sinal', () => {
  const r = decidirEncerramentos([vaga(1, { dataPublicacao: haDias(6.5) })], [consulta([])], AGORA);
  assert.deepEqual(r.encerrar, []);
});

test('consulta que encerraria mais da metade é ignorada como suspeita', () => {
  const vagas = Array.from({ length: 10 }, (_, i) => vaga(i));
  const r = decidirEncerramentos(vagas, [consulta(['g0', 'g1'])], AGORA);
  assert.deepEqual(r.encerrar, []);
  assert.equal(r.suspeitas.length, 1);
});

test('poucas sumidas não disparam a suspeita, mesmo sendo maioria', () => {
  const r = decidirEncerramentos([vaga(1), vaga(2), vaga(3)], [consulta(['g1'])], AGORA);
  assert.deepEqual(r.encerrar.sort(), [2, 3]);
});

test('vaga encerrada que reaparece é reaberta', () => {
  const r = decidirEncerramentos([vaga(1, { encerradaEm: haDias(1) })], [consulta(['g1'])], AGORA);
  assert.deepEqual(r.reabrir, [1]);
  assert.deepEqual(r.encerrar, []);
});

test('cargo e cidade casam sem diferenciar maiúscula nem espaço', () => {
  const r = decidirEncerramentos([vaga(1, { cargoBusca: 'vendedor ' })], [consulta([])], AGORA);
  assert.deepEqual(r.encerrar, [1]);
});
