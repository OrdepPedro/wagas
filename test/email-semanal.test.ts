import test from 'node:test';
import assert from 'node:assert/strict';
import { inicioDaSemana, montarEmail, UUID, VAGAS_NO_EMAIL, vagasNovas, type VagaDoEmail } from '../src/email/semanal.ts';

const AGORA = new Date('2026-11-30T10:00:00Z');

function v(id: number, ref: string, extra: Partial<VagaDoEmail> = {}): VagaDoEmail {
  return {
    id, empresa: 'Drogaria Araujo', cargo: 'Vendedor', modelo: 'presencial', localizacao: 'Belo Horizonte, MG',
    cidade_slug: 'belo-horizonte', data_publicacao: ref, data_referencia: ref, tipo_contrato: null, ...extra,
  };
}

test('sem envio anterior, a semana começa 7 dias atrás', () => {
  assert.equal(inicioDaSemana(null, AGORA).toISOString(), '2026-11-23T10:00:00.000Z');
});

test('com envio recente, conta desde o último envio', () => {
  assert.equal(inicioDaSemana('2026-11-28T10:00:00Z', AGORA).toISOString(), '2026-11-28T10:00:00.000Z');
});

test('envio antigo não puxa vaga que já saiu do feed: piso de 7 dias', () => {
  assert.equal(inicioDaSemana('2026-10-01T10:00:00Z', AGORA).toISOString(), '2026-11-23T10:00:00.000Z');
  assert.equal(inicioDaSemana('lixo', AGORA).toISOString(), '2026-11-23T10:00:00.000Z');
});

test('só entra o que é novo desde o início, mais nova primeiro, com teto', () => {
  const desde = new Date('2026-11-28T00:00:00Z');
  const vagas = [
    v(1, '2026-11-27T23:59:00Z'),
    v(2, '2026-11-28T00:00:00Z'),
    v(3, '2026-11-29T12:00:00Z'),
    ...Array.from({ length: 12 }, (_, i) => v(10 + i, `2026-11-29T0${i % 10}:00:00Z`)),
  ];
  const r = vagasNovas(vagas, desde);
  assert.equal(r.total, 14);
  assert.equal(r.mostrar.length, VAGAS_NO_EMAIL);
  assert.equal(r.mostrar[0]!.id, 3);
  assert.ok(!r.mostrar.some((x) => x.id === 1));
});

const BASE = {
  cargo: 'Vendedor', cidade: 'Belo Horizonte', soRemoto: false, site: 'https://www.wagas.com.br/',
  envioId: '11111111-2222-4333-8444-555555555555', descadastro: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
};

test('cada link passa por /ir com o id do envio, e o descadastro está no corpo', () => {
  const e = montarEmail({ ...BASE, vagas: [v(42, '2026-11-29T12:00:00Z')], total: 1 });
  assert.equal(e.assunto, '1 vaga nova de Vendedor esta semana');
  assert.ok(e.html.includes('https://www.wagas.com.br/ir/42?envio=11111111-2222-4333-8444-555555555555'));
  assert.ok(e.texto.includes('https://www.wagas.com.br/ir/42?envio='));
  assert.equal(e.linkDescadastro, 'https://www.wagas.com.br/email/descadastrar?t=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.ok(e.html.includes(e.linkDescadastro));
  assert.ok(!e.html.includes('E mais'));
});

test('texto da vaga é escapado: cargo vem de fonte externa', () => {
  const e = montarEmail({ ...BASE, vagas: [v(1, '2026-11-29T12:00:00Z', { cargo: '<script>x</script> & cia' })], total: 1 });
  assert.ok(!e.html.includes('<script>'));
  assert.ok(e.html.includes('&lt;script&gt;x&lt;/script&gt; &amp; cia'));
});

test('data sem publicação real é dita como "vista", nunca "publicada"', () => {
  const e = montarEmail({
    ...BASE, total: 1,
    vagas: [v(1, '2026-11-29T12:00:00Z', { data_publicacao: null, empresa: 'não identificada' })],
  });
  assert.ok(e.texto.includes('vista em 29/11'));
  assert.ok(!e.texto.includes('publicada'));
  assert.ok(!e.texto.includes('não identificada'));
});

test('o que não coube no corpo é contado, e remoto diz o Brasil', () => {
  const e = montarEmail({
    ...BASE, soRemoto: true, total: 25,
    vagas: [v(1, '2026-11-29T12:00:00Z', { modelo: 'remoto', localizacao: 'Recife, PE' })],
  });
  assert.equal(e.assunto, '25 vagas novas de Vendedor esta semana');
  assert.ok(e.html.includes('E mais 24 no seu feed'));
  assert.ok(e.texto.includes('Remoto no Brasil'));
  assert.ok(e.html.includes('remoto em todo o Brasil'));
});

test('UUID aceita só uuid', () => {
  assert.ok(UUID.test(BASE.envioId));
  assert.ok(!UUID.test("1' or '1'='1"));
});
