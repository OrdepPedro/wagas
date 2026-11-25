import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distribuir, inicioDaSemana, montarEmail, UUID, VAGAS_NO_EMAIL, VAGAS_POR_BLOCO, vagasNovas, type VagaDoEmail,
} from '../src/email/semanal.ts';

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
  site: 'https://www.wagas.com.br/',
  envioId: '11111111-2222-4333-8444-555555555555', descadastro: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
};
const BUSCA = { cargo: 'Vendedor', cidade: 'Belo Horizonte', soRemoto: false };
const um = (vagas: VagaDoEmail[], total: number, extra: Partial<typeof BUSCA> = {}) => ({
  ...BASE, blocos: [{ ...BUSCA, ...extra, vagas, total }],
});

test('cada link passa por /ir com o id do envio, e o descadastro está no corpo', () => {
  const e = montarEmail(um([v(42, '2026-11-29T12:00:00Z')], 1));
  assert.equal(e.assunto, '1 vaga nova de Vendedor esta semana');
  assert.ok(e.html.includes('https://www.wagas.com.br/ir/42?envio=11111111-2222-4333-8444-555555555555'));
  assert.ok(e.texto.includes('https://www.wagas.com.br/ir/42?envio='));
  assert.equal(e.linkDescadastro, 'https://www.wagas.com.br/email/descadastrar?t=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.ok(e.html.includes(e.linkDescadastro));
  assert.ok(!e.html.includes('E mais'));
});

test('texto da vaga é escapado: cargo vem de fonte externa', () => {
  const e = montarEmail(um([v(1, '2026-11-29T12:00:00Z', { cargo: '<script>x</script> & cia' })], 1));
  assert.ok(!e.html.includes('<script>'));
  assert.ok(e.html.includes('&lt;script&gt;x&lt;/script&gt; &amp; cia'));
});

test('data sem publicação real é dita como "vista", nunca "publicada"', () => {
  const e = montarEmail(um([v(1, '2026-11-29T12:00:00Z', { data_publicacao: null, empresa: 'não identificada' })], 1));
  assert.ok(e.texto.includes('vista em 29/11'));
  assert.ok(!e.texto.includes('publicada'));
  assert.ok(!e.texto.includes('não identificada'));
});

test('o que não coube no corpo é contado, e remoto diz o Brasil', () => {
  const e = montarEmail(um([v(1, '2026-11-29T12:00:00Z', { modelo: 'remoto', localizacao: 'Recife, PE' })], 25, { soRemoto: true }));
  assert.equal(e.assunto, '25 vagas novas de Vendedor esta semana');
  assert.ok(e.html.includes('E mais 24 no wagas'));
  assert.ok(e.texto.includes('Remoto no Brasil'));
  assert.ok(e.html.includes('remoto em todo o Brasil'));
});

test('UUID aceita só uuid', () => {
  assert.ok(UUID.test(BASE.envioId));
  assert.ok(!UUID.test("1' or '1'='1"));
});

test('várias buscas: vaga repetida fica só na primeira, busca sem nada novo some, teto menor', () => {
  const ref = '2026-11-29T12:00:00Z';
  const blocos = distribuir([
    { ...BUSCA, cargo: 'Analista de Dados', vagas: [v(1, ref), v(2, ref)], total: 2 },
    { ...BUSCA, cargo: 'Cientista de Dados', vagas: [v(2, ref), v(3, ref)], total: 2 },
    { ...BUSCA, cargo: 'Engenheiro de Dados', vagas: [v(1, ref)], total: 1 },
    { ...BUSCA, cargo: 'Vendedor', vagas: Array.from({ length: 9 }, (_, i) => v(100 + i, ref)), total: 30 },
  ]);
  assert.deepEqual(blocos.map((b) => b.cargo), ['Analista de Dados', 'Cientista de Dados', 'Vendedor']);
  assert.deepEqual(blocos[1]!.vagas.map((x) => x.id), [3]);
  assert.equal(blocos[1]!.total, 1);
  assert.equal(blocos[2]!.vagas.length, VAGAS_POR_BLOCO);
  assert.equal(blocos[2]!.total, 30);
});

test('uma busca só mantém o teto cheio', () => {
  const ref = '2026-11-29T12:00:00Z';
  const [b] = distribuir([{ ...BUSCA, vagas: Array.from({ length: 12 }, (_, i) => v(i + 1, ref)), total: 12 }]);
  assert.equal(b!.vagas.length, VAGAS_NO_EMAIL);
});

test('e-mail com várias buscas: assunto somado, uma seção por busca, links contados', () => {
  const ref = '2026-11-29T12:00:00Z';
  const e = montarEmail({
    ...BASE,
    blocos: [
      { ...BUSCA, vagas: [v(1, ref)], total: 3 },
      { cargo: 'Product Owner', cidade: 'Recife', soRemoto: true, vagas: [v(2, ref, { cargo: 'Product Owner' })], total: 1 },
    ],
  });
  assert.equal(e.assunto, '4 vagas novas nas suas 2 buscas esta semana');
  assert.ok(e.html.includes('Product Owner <span'));
  assert.ok(e.html.includes('remoto em todo o Brasil'));
  assert.ok(e.texto.includes('== Vendedor · Belo Horizonte e remoto no Brasil · 3 vagas novas =='));
  assert.ok(e.texto.includes('E mais 2 no wagas.'));
  assert.ok(e.html.includes('/ir/2?envio='));
  assert.ok(e.html.includes('as vagas novas de Vendedor, Product Owner toda semana'));
});
