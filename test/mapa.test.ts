import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERFIL_VAZIO,
  estadoDoAcesso,
  motivoDoCorte,
  perfilDoFormulario,
  separar,
  validarManual,
  type PerfilDoMapa,
} from '../src/mapa/regras.ts';

const vaga = (extra: Partial<{ senioridade: string | null; modelo: string | null; tipo_contrato: string | null }> = {}) => ({
  senioridade: null, modelo: null, tipo_contrato: null, ...extra,
});
const perfil = (extra: Partial<PerfilDoMapa> = {}): PerfilDoMapa => ({ ...PERFIL_VAZIO, ...extra });

test('perfil vazio não recolhe nada', () => {
  assert.equal(motivoDoCorte(vaga({ senioridade: 'senior', modelo: 'presencial', tipo_contrato: 'PJ' }), PERFIL_VAZIO), null);
});

test('vaga acima do nível da pessoa é recolhida; abaixo e igual ficam à vista', () => {
  const junior = perfil({ nivel: 'junior' });
  assert.equal(motivoDoCorte(vaga({ senioridade: 'senior' }), junior), 'nivel');
  assert.equal(motivoDoCorte(vaga({ senioridade: 'pleno' }), junior), 'nivel');
  assert.equal(motivoDoCorte(vaga({ senioridade: 'junior' }), junior), null);
  assert.equal(motivoDoCorte(vaga({ senioridade: 'estagio' }), junior), null);
});

// O erro caro: senioridade falta em boa parte do acervo. Cortar o desconhecido
// esconderia vaga boa em silêncio.
test('dado ausente nunca corta', () => {
  const exigente = perfil({ nivel: 'estagio', modelos: ['remoto'], contrato: 'clt' });
  assert.equal(motivoDoCorte(vaga(), exigente), null);
});

test('senioridade que o Mapa não conhece não corta', () => {
  assert.equal(motivoDoCorte(vaga({ senioridade: 'trainee' }), perfil({ nivel: 'estagio' })), null);
});

test('modelo de trabalho fora dos aceitos é recolhido', () => {
  const soRemoto = perfil({ modelos: ['remoto', 'hibrido'] });
  assert.equal(motivoDoCorte(vaga({ modelo: 'presencial' }), soRemoto), 'modelo');
  assert.equal(motivoDoCorte(vaga({ modelo: 'hibrido' }), soRemoto), null);
});

test('contrato só corta quando a vaga declara o outro regime', () => {
  const clt = perfil({ contrato: 'clt' });
  assert.equal(motivoDoCorte(vaga({ tipo_contrato: 'Prestador de Serviços (PJ) - Período Integral' }), clt), 'contrato');
  assert.equal(motivoDoCorte(vaga({ tipo_contrato: 'Efetivo – CLT - Período Integral' }), clt), null);
  assert.equal(motivoDoCorte(vaga({ tipo_contrato: 'CLT ou PJ' }), clt), null);
  assert.equal(motivoDoCorte(vaga({ tipo_contrato: 'Estágio' }), clt), null);
  assert.equal(motivoDoCorte(vaga({ tipo_contrato: 'Efetivo – CLT' }), perfil({ contrato: 'pj' })), 'contrato');
});

test('separar conta por motivo e não perde vaga', () => {
  const r = separar(
    [vaga({ senioridade: 'senior' }), vaga({ modelo: 'presencial' }), vaga(), vaga({ senioridade: 'senior', modelo: 'presencial' })],
    perfil({ nivel: 'junior', modelos: ['remoto'] }),
  );
  assert.equal(r.visiveis.length, 1);
  assert.equal(r.recolhidas.length, 3);
  // A vaga com dois motivos conta uma vez, pelo primeiro.
  assert.deepEqual(r.contagem, { nivel: 2, modelo: 1, contrato: 0 });
});

test('pretensão aceita as grafias comuns e recusa o absurdo', () => {
  const ler = (pretensao: string) => perfilDoFormulario({ nivel: '', modelos: [], contrato: '', pretensao }).pretensao;
  assert.equal(ler('3500'), 3500);
  assert.equal(ler('R$ 3.500,00'), 3500);
  assert.equal(ler('3.500'), 3500);
  assert.equal(ler(''), null);
  assert.equal(ler('50'), null);
  assert.equal(ler('9999999'), null);
});

test('formulário com valor desconhecido vira "não filtra"', () => {
  const p = perfilDoFormulario({ nivel: 'chefe', modelos: ['remoto', 'lua'], contrato: 'x', pretensao: '' });
  assert.deepEqual(p, { nivel: null, modelos: ['remoto'], contrato: 'tanto_faz', pretensao: null });
});

test('acesso: sem linha, em teste, expirado e pago', () => {
  const agora = new Date('2026-11-17T12:00:00Z');
  assert.equal(estadoDoAcesso(null, agora).estado, 'sem_teste');

  const emTeste = estadoDoAcesso({ trial_inicio: '2026-11-16T12:00:00Z', pago_ate: null }, agora);
  assert.equal(emTeste.estado, 'teste');
  assert.equal(emTeste.estado === 'teste' && emTeste.horasRestantes, 48);

  assert.equal(estadoDoAcesso({ trial_inicio: '2026-11-14T11:59:00Z', pago_ate: null }, agora).estado, 'expirado');
  assert.equal(estadoDoAcesso({ trial_inicio: '2026-10-01T00:00:00Z', pago_ate: '2026-12-01T00:00:00Z' }, agora).estado, 'pago');
  // Assinatura vencida trava de novo: o teste não recomeça.
  assert.equal(estadoDoAcesso({ trial_inicio: '2026-10-01T00:00:00Z', pago_ate: '2026-11-01T00:00:00Z' }, agora).estado, 'expirado');
});

test('candidatura manual: valida e normaliza', () => {
  const hoje = new Date('2026-11-17T12:00:00Z');
  const ok = validarManual({ cargo: '  Analista   de Dados ', empresa: 'Acme', url: '', enviada_em: '', status: 'entrevista' }, hoje);
  assert.deepEqual(ok, { cargo: 'Analista de Dados', empresa: 'Acme', url: null, enviada_em: '2026-11-17', status: 'entrevista' });

  assert.ok('erro' in validarManual({ cargo: '', empresa: 'Acme', url: '', enviada_em: '', status: '' }, hoje));
  assert.ok('erro' in validarManual({ cargo: 'Dev', empresa: 'Acme', url: 'javascript:alert(1)', enviada_em: '', status: '' }, hoje));
  assert.ok('erro' in validarManual({ cargo: 'Dev', empresa: 'Acme', url: '', enviada_em: '2027-01-01', status: '' }, hoje));
  // "Não me candidatei" não é um status que se insere à mão.
  const r = validarManual({ cargo: 'Dev', empresa: 'Acme', url: 'https://acme.com/vaga', enviada_em: '2026-11-10', status: 'nao_enviada' }, hoje);
  assert.equal('erro' in r ? null : r.status, 'enviada');
});
