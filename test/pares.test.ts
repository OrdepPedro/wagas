import test from 'node:test';
import assert from 'node:assert/strict';
import { montarPares, ufMaisFrequente, type BuscaRegistrada } from '../src/coleta/pares.ts';

const AGORA = new Date('2026-10-22T12:00:00Z');

function busca(user: string, cargo: string, cidade: string, slug: string, dias = 1): BuscaRegistrada {
  return { user_id: user, cargo, cidade, cidade_slug: slug, criado_em: new Date(AGORA.getTime() - dias * 864e5).toISOString() };
}

test('pré-carga vira cargo × cidade, com nome acentuado e UF', () => {
  const pares = montarPares({
    cargos: ['Vendedor', 'Enfermeiro'],
    cidades: [{ nome: 'São Paulo', uf: 'SP' }],
    buscas: [], ufPorSlug: new Map(), agora: AGORA,
  });
  assert.equal(pares.length, 2);
  assert.deepEqual(pares.map((p) => [p.cidade, p.cidadeSlug, p.uf]), [['São Paulo', 'sao-paulo', 'SP'], ['São Paulo', 'sao-paulo', 'SP']]);
});

test('demanda é ordenada por pessoas distintas, não por número de buscas', () => {
  const pares = montarPares({
    cargos: [], cidades: [],
    buscas: [
      busca('a', 'Motorista', 'Recife', 'recife'),
      busca('a', 'Motorista', 'Recife', 'recife'),
      busca('a', 'Motorista', 'Recife', 'recife'),
      busca('b', 'Garçom', 'Recife', 'recife'),
      busca('c', 'Garçom', 'Recife', 'recife'),
    ],
    ufPorSlug: new Map([['recife', 'PE']]), agora: AGORA,
  });
  assert.deepEqual(pares.map((p) => [p.cargo, p.pessoas, p.uf]), [['Garçom', 2, 'PE'], ['Motorista', 1, 'PE']]);
});

test('o mesmo par na pré-carga e na demanda não é coletado duas vezes', () => {
  const pares = montarPares({
    cargos: ['Vendedor'], cidades: [{ nome: 'Belo Horizonte', uf: 'MG' }],
    buscas: [busca('a', 'vendedor ', 'Belo Horizonte', 'belo-horizonte')],
    ufPorSlug: new Map(), agora: AGORA,
  });
  assert.equal(pares.length, 1);
  assert.equal(pares[0]!.origem, 'pre_carga');
  assert.equal(pares[0]!.pessoas, 1);
});

test('demanda velha sai da lista — senão um pedido de agosto seria coletado para sempre', () => {
  const pares = montarPares({
    cargos: [], cidades: [],
    buscas: [busca('a', 'Motorista', 'Recife', 'recife', 45)],
    ufPorSlug: new Map(), agora: AGORA,
  });
  assert.equal(pares.length, 0);
});

test('cidade sem UF conhecida entra com uf null — o InfoJobs pula, a Gupy não precisa', () => {
  const [par] = montarPares({
    cargos: [], cidades: [],
    buscas: [busca('a', 'Motorista', 'Bom Jesus', 'bom-jesus')],
    ufPorSlug: new Map(), agora: AGORA,
  });
  assert.equal(par!.uf, null);
});

test('teto de pares de demanda: o tempo da madrugada é finito', () => {
  const buscas = Array.from({ length: 5 }, (_, i) => busca(`u${i}`, `Cargo ${i}`, 'Recife', 'recife'));
  assert.equal(montarPares({ cargos: [], cidades: [], buscas, ufPorSlug: new Map(), agora: AGORA, maxDemanda: 3 }).length, 3);
});

test('UF mais frequente por cidade, ignorando linha sem cidade ou sem UF', () => {
  const m = ufMaisFrequente([
    { cidade_slug: 'bom-jesus', uf: 'PI' },
    { cidade_slug: 'bom-jesus', uf: 'RS' },
    { cidade_slug: 'bom-jesus', uf: 'RS' },
    { cidade_slug: null, uf: 'SP' },
    { cidade_slug: 'recife', uf: null },
  ]);
  assert.equal(m.get('bom-jesus'), 'RS');
  assert.equal(m.has('recife'), false);
});
