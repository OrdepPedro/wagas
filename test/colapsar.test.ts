import test from 'node:test';
import assert from 'node:assert/strict';
import { colapsarRepetidas, type VagaColapsavel } from '../src/feed/colapsar.ts';

type V = VagaColapsavel & { id: number };
function v(id: number, extra: Partial<V> = {}): V {
  return {
    id, empresa: 'Drogaria Araujo', cargo: 'Vendedor', fonte: 'ats_gupy', cidade_slug: 'belo-horizonte',
    // Descrição única por id: por padrão, anúncios distintos. Quem testa
    // anúncio repetido passa a mesma descrição de propósito.
    modelo: 'presencial', data_publicacao: '2026-10-20T12:00:00Z', descricao: `descrição ${id}`, ...extra,
  };
}
const ids = (r: { vagas: V[] }) => r.vagas.map((x) => x.id);

test('a mesma vaga em duas fontes aparece uma vez, e fica a que tem data real', () => {
  const r = colapsarRepetidas([
    v(1, { fonte: 'linkedin_job', data_publicacao: null }),
    v(2, { fonte: 'ats_gupy' }),
  ]);
  assert.deepEqual(ids(r), [2]);
  assert.equal(r.colapsadas, 1);
});

test('anúncios da mesma fonte com ids diferentes ficam todos — são lojas diferentes', () => {
  const r = colapsarRepetidas([v(1), v(2), v(3)]);
  assert.deepEqual(ids(r), [1, 2, 3]);
  assert.equal(r.colapsadas, 0);
});

test('o mesmo anúncio publicado 29 vezes vira um cartão, com a contagem', () => {
  // Caso real de 23/10: McDonald's, mesmo título com o bairro, mesmo texto.
  const anuncio = { empresa: "McDonald's", cargo: 'ATENDENTE DE RESTAURANTE ( TIJUCA - RIO DE JANEIRO/RJ)', descricao: 'Vem ser McDonald’s!' };
  const r = colapsarRepetidas([
    ...Array.from({ length: 29 }, (_, i) => v(i + 1, anuncio)),
    v(100, { ...anuncio, cargo: 'ATENDENTE DE RESTAURANTE ( BARRA DA TIJUCA - RIO DE JANEIRO/RJ)' }),
  ]);
  assert.deepEqual(r.vagas.map((x) => [x.id, x.repeticoes]), [[1, 29], [100, 1]]);
  assert.equal(r.colapsadas, 28);
});

test('mesmo título com descrição diferente são anúncios diferentes', () => {
  const r = colapsarRepetidas([v(1), v(2)]);
  assert.equal(r.vagas.length, 2);
});

test('mesma empresa e cargo em outra cidade não é a mesma vaga', () => {
  const r = colapsarRepetidas([v(1), v(2, { fonte: 'portal_infojobs', cidade_slug: 'sao-paulo' })]);
  assert.deepEqual(ids(r), [1, 2]);
});

test('remoto colapsa com remoto, não com presencial da cidade', () => {
  const r = colapsarRepetidas([
    v(1, { modelo: 'remoto', cidade_slug: null }),
    v(2, { modelo: 'remoto', cidade_slug: null, fonte: 'portal_infojobs' }),
    v(3, { fonte: 'linkedin_job' }),
  ]);
  assert.equal(r.vagas.length, 2);
});

test('empresa não identificada nunca colapsa — não é evidência de nada', () => {
  const r = colapsarRepetidas([
    v(1, { empresa: 'não identificada', fonte: 'linkedin_job' }),
    v(2, { empresa: 'não identificada' }),
    v(3, { empresa: 'Empresa confidencial', fonte: 'portal_infojobs' }),
    v(4, { empresa: 'Empresa confidencial' }),
  ]);
  assert.deepEqual(ids(r), [1, 2, 3, 4]);
});

test('grafia de empresa e de cargo não separa a mesma vaga', () => {
  const r = colapsarRepetidas([
    v(1, { empresa: 'Drogaria Araújo LTDA', cargo: 'VENDEDOR', fonte: 'portal_infojobs' }),
    v(2),
  ]);
  assert.equal(r.vagas.length, 1);
});

test('a ordem do feed é mantida: o grupo fica onde apareceu primeiro', () => {
  const r = colapsarRepetidas([
    v(1, { empresa: 'A' }),
    v(2, { fonte: 'linkedin_job', data_publicacao: null }),
    v(3, { empresa: 'B' }),
    v(4),
  ]);
  assert.deepEqual(ids(r), [1, 4, 3]);
});
