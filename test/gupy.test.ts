import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarNaGupy, normalizarItem, statusNaPagina, vagaFechadaNaGupy } from '../src/fontes/gupy.ts';

const AGORA = new Date('2026-08-26T12:00:00Z');

/** Item real da API, com os campos como ela devolve. */
function item(extra: Record<string, unknown> = {}) {
  return {
    id: 12289361,
    name: 'Enfermeiro (a) do Trabalho',
    careerPageName: 'Afya',
    city: 'Belo Horizonte',
    state: 'Minas Gerais',
    country: 'Brasil',
    workplaceType: 'hybrid',
    isRemoteWork: false,
    publishedDate: '2026-08-26T00:24:37.931Z',
    jobUrl: 'https://afya.gupy.io/job/abc?jobBoardSource=gupy_portal',
    ...extra,
  };
}

/** Fetch de mentira: devolve as páginas na ordem, e depois vazio. */
function fetchFalso(paginas: Array<Array<Record<string, unknown>>>): typeof fetch {
  let i = 0;
  return (async () => {
    const dados = paginas[i++] ?? [];
    return new Response(JSON.stringify({ data: dados }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

test('extrai os campos que a SERP não dava', () => {
  const v = normalizarItem(item())!;
  assert.equal(v.empresa, 'Afya');
  assert.equal(v.modelo, 'hibrido');
  assert.equal(v.cidadeSlug, 'belo-horizonte');
  assert.equal(v.uf, 'MG');
  assert.equal(v.dataPublicacao, '2026-08-26T00:24:37.931Z');
});

test('os três modelos de trabalho da API viram os três do produto', () => {
  assert.equal(normalizarItem(item({ workplaceType: 'remote' }))!.modelo, 'remoto');
  assert.equal(normalizarItem(item({ workplaceType: 'hybrid' }))!.modelo, 'hibrido');
  assert.equal(normalizarItem(item({ workplaceType: 'on-site' }))!.modelo, 'presencial');
});

test('item sem url, título ou data não é aproveitável', () => {
  for (const faltando of [{ jobUrl: '' }, { name: '' }, { publishedDate: '' }]) {
    assert.equal(normalizarItem(item(faltando)), null, JSON.stringify(faltando));
  }
});

test('a janela de 7 dias corta pela data de publicação de verdade', async () => {
  const r = await buscarNaGupy({
    cargo: 'Enfermeiro',
    agora: AGORA,
    buscar: fetchFalso([
      [
        item({ id: 1, publishedDate: '2026-08-25T10:00:00Z' }),
        item({ id: 2, publishedDate: '2026-07-01T10:00:00Z' }),
      ],
    ]),
  });
  assert.equal(r.vagas.length, 1);
  assert.equal(r.foraDaJanela, 1);
  assert.equal(r.vagas[0]!.fonteId, '1');
});

/**
 * `jobName` casa por substring, então a API traz cargo de outra família. Quem
 * separa é a MESMA regra do pré-filtro — não uma segunda regra escrita aqui.
 */
test('cargo de outra família cai pela regra do pré-filtro', async () => {
  const r = await buscarNaGupy({
    cargo: 'Analista de Dados',
    agora: AGORA,
    buscar: fetchFalso([
      [
        item({ id: 1, name: 'Analista de Dados Pleno' }),
        item({ id: 2, name: 'Analista de Tesouraria' }),
      ],
    ]),
  });
  assert.equal(r.vagas.length, 1);
  assert.equal(r.outraFamilia, 1);
});

/** A promessa do produto, com campo estruturado em vez de julgamento do LLM. */
test('presencial de outra cidade não serve; remoto de qualquer cidade serve', async () => {
  const r = await buscarNaGupy({
    cargo: 'Enfermeiro',
    cidade: 'Belo Horizonte',
    agora: AGORA,
    buscar: fetchFalso([
      [
        item({ id: 1, city: 'Belo Horizonte', workplaceType: 'on-site' }),
        item({ id: 2, city: 'Recife', state: 'Pernambuco', workplaceType: 'on-site' }),
        item({ id: 3, city: 'Recife', state: 'Pernambuco', workplaceType: 'remote' }),
      ],
    ]),
  });
  assert.deepEqual(
    r.vagas.map((v) => v.fonteId),
    ['1', '3'],
  );
});

test('fonte fora do ar devolve lista vazia, não derruba o feed', async () => {
  const explode = (async () => {
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch;

  const r = await buscarNaGupy({ cargo: 'Enfermeiro', agora: AGORA, buscar: explode });
  assert.deepEqual(r.vagas, []);
  assert.equal(r.vistos, 0);
});

test('resposta com erro HTTP também degrada em silêncio', async () => {
  const quinhentos = (async () => new Response('erro', { status: 503 })) as unknown as typeof fetch;
  const r = await buscarNaGupy({ cargo: 'Enfermeiro', agora: AGORA, buscar: quinhentos });
  assert.deepEqual(r.vagas, []);
});

/** A API ordena por data desc: página inteira vencida encerra a paginação. */
test('para de paginar quando a página inteira saiu da janela', async () => {
  const velhas = Array.from({ length: 100 }, (_, i) =>
    item({ id: 100 + i, publishedDate: '2026-01-01T00:00:00Z' }),
  );
  const nuncaLida = [item({ id: 999, publishedDate: '2026-08-26T00:00:00Z' })];

  const r = await buscarNaGupy({
    cargo: 'Enfermeiro',
    agora: AGORA,
    limite: 300,
    buscar: fetchFalso([velhas, nuncaLida]),
  });

  assert.equal(r.vagas.length, 0);
  assert.equal(r.vistos, 100, 'não devia ter pedido a segunda página');
});

/**
 * `idsVistos` e `completa` sustentam o encerramento de vaga (migration 0011):
 * concluir "sumiu da fonte" com varredura cortada encerraria vaga aberta.
 */
test('idsVistos traz tudo o que a API listou, inclusive o que os filtros cortaram', async () => {
  const r = await buscarNaGupy({
    cargo: 'Analista de Dados',
    agora: AGORA,
    buscar: fetchFalso([
      [
        item({ id: 1, name: 'Analista de Dados Pleno' }),
        item({ id: 2, name: 'Analista de Tesouraria' }),
        item({ id: 3, name: 'Analista de Dados', publishedDate: '2026-07-01T10:00:00Z' }),
      ],
    ]),
  });
  assert.deepEqual(r.idsVistos, ['1', '2', '3']);
  assert.equal(r.completa, true);
});

test('varredura cortada pelo limite não é completa', async () => {
  const cheia = Array.from({ length: 100 }, (_, i) => item({ id: i }));
  const r = await buscarNaGupy({ cargo: 'Enfermeiro', agora: AGORA, limite: 100, buscar: fetchFalso([cheia, cheia]) });
  assert.equal(r.completa, false);
});

test('varredura que falhou não é completa', async () => {
  const falha = (async () => new Response('erro', { status: 500 })) as unknown as typeof fetch;
  const r = await buscarNaGupy({ cargo: 'Enfermeiro', agora: AGORA, buscar: falha });
  assert.equal(r.completa, false);
  assert.equal(r.falhou, true);
});

test('a situação da vaga sai do JSON embutido na página', async () => {
  const pagina = (status: string) =>
    `<html><script id="__NEXT_DATA__" type="application/json">{"props":{"job":{"id":1,"status":"${status}"}}}</script></html>`;
  assert.equal(statusNaPagina(pagina('closed')), 'closed');
  assert.equal(statusNaPagina(pagina('published')), 'published');
  assert.equal(statusNaPagina('<html>tela de login</html>'), null);

  const responde = (corpo: string, status = 200) =>
    (async () => new Response(corpo, { status })) as unknown as typeof fetch;
  assert.equal(await vagaFechadaNaGupy('https://x.gupy.io/job/1', responde(pagina('closed'))), true);
  assert.equal(await vagaFechadaNaGupy('https://x.gupy.io/job/1', responde(pagina('published'))), false);
  assert.equal(await vagaFechadaNaGupy('https://x.gupy.io/job/1', responde('', 503)), false);
});
