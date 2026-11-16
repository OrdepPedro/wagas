import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarNoGreenhouse, locaisDoGreenhouse, modeloDaDescricao, normalizarItemGreenhouse, textoDaDescricao } from '../src/fontes/greenhouse.ts';
import { decidirEncerramento } from '../src/coleta/greenhouse.ts';
import { canonicalizarUrl } from '../src/normalize/url.ts';

const cidades = (nome: string, soBrasil = true) => locaisDoGreenhouse(nome, soBrasil).map((l) => l.cidadeSlug);

// Todos os formatos abaixo são `location.name` reais, conferidos em 14/11.

test('endereço completo, com e sem acento', () => {
  assert.deepEqual(cidades('Sao Paulo, Sao Paulo, Brasil'), ['sao-paulo']);
  assert.deepEqual(cidades('Osasco, Sao Paulo, Brasil'), ['osasco']);
  assert.deepEqual(cidades('Belo Horizonte, Minas Gerais, Brazil'), ['belo-horizonte']);
  assert.deepEqual(cidades('São Paulo, SP'), ['sao-paulo']);
  assert.deepEqual(cidades('São Paulo'), ['sao-paulo']);
});

test('várias cidades viram várias entradas', () => {
  assert.deepEqual(cidades('Belo Horizonte, MG; Curitiba, PR; Recife, PE; São Paulo, SP'), [
    'belo-horizonte', 'curitiba', 'recife', 'sao-paulo',
  ]);
  assert.deepEqual(cidades('Curitiba or São Paulo | Hybrid', false), ['curitiba', 'sao-paulo']);
  assert.deepEqual(cidades('São Paulo ou Rio de Janeiro'), ['sao-paulo', 'rio-de-janeiro']);
  assert.deepEqual(cidades('São Paulo e Rio de Janeiro'), ['sao-paulo', 'rio-de-janeiro']);
  assert.deepEqual(cidades('São Paulo / Rio de Janeiro'), ['sao-paulo', 'rio-de-janeiro']);
});

test('"São Paulo, Rio de Janeiro" são duas cidades, não São Paulo no estado do Rio', () => {
  const locais = locaisDoGreenhouse('São Paulo, Rio de Janeiro ou Teletrabalho', true);
  assert.deepEqual(locais.map((l) => [l.cidadeSlug, l.uf]), [['sao-paulo', 'SP'], ['rio-de-janeiro', 'RJ']]);
});

test('país antes da cidade, entre parênteses', () => {
  assert.deepEqual(cidades('Brazil (São Paulo - Hybrid)', false), ['sao-paulo']);
  assert.deepEqual(cidades('Brazil (Belo Horizonte - Hybrid)', false), ['belo-horizonte']);
});

test('sem cidade: entra uma vez, sem cidade, quando o país é Brasil', () => {
  for (const nome of ['Remoto', 'Brasil', 'Brazil (Remote)', 'Remoto, Brasil']) {
    const locais = locaisDoGreenhouse(nome, true);
    assert.deepEqual(locais.map((l) => [l.cidadeSlug, l.paisBr]), [[null, true]], nome);
  }
});

test('quadro internacional: sem país escrito fica de fora, salvo capital', () => {
  assert.deepEqual(cidades('Remote', false), []);
  assert.deepEqual(cidades('London l Remote', false), []);
  assert.deepEqual(cidades('Singapore | Hybrid', false), []);
  assert.deepEqual(cidades('US (Remote)', false), []);
  assert.deepEqual(cidades('Curitiba | On-site', false), ['curitiba']);
  assert.deepEqual(locaisDoGreenhouse('Brazil (Remote)', false).map((l) => l.paisBr), [true]);
});

test('fora do Brasil confirmado sai até de quadro brasileiro', () => {
  assert.deepEqual(cidades('Miami, FL'), []);
  assert.deepEqual(cidades('Mexico City, Mexico City, Mexico'), []);
  assert.deepEqual(cidades('Argentina'), []);
});

test('quadro brasileiro aceita cidade sem estado', () => {
  assert.deepEqual(cidades('Salvador'), ['salvador']);
  assert.deepEqual(cidades('Limeira'), ['limeira']);
  assert.deepEqual(cidades('Híbrido, Rio de Janeiro'), ['rio-de-janeiro']);
});

test('descrição: decodifica as entidades antes de tirar as tags', () => {
  const content = '&lt;p&gt;&lt;strong&gt;Sobre a Stone:&lt;/strong&gt;&lt;/p&gt;\n&lt;p&gt;Fintech &amp;amp; tecnologia&lt;/p&gt;';
  assert.equal(textoDaDescricao(content), 'Sobre a Stone:\nFintech & tecnologia');
});

const QUADRO = { slug: 'stone', empresa: 'Stone', soBrasil: true };
const ITEM = {
  id: 8201530003,
  title: 'Account Executive – Cobertura de Carteira',
  company_name: 'Stone - Linkedin',
  absolute_url: 'https://job-boards.greenhouse.io/stone/jobs/8201530003',
  first_published: '2026-11-12T06:02:23-05:00',
  location: { name: 'Sao Paulo, Sao Paulo, Brasil' },
  content: '&lt;p&gt;Modelo de trabalho: híbrido, 3 dias no escritório.&lt;/p&gt;',
};

test('item: empresa da configuração, não o `company_name`, e modelo pela descrição como reserva', () => {
  const v = normalizarItemGreenhouse(ITEM, QUADRO)!;
  assert.equal(v.empresa, 'Stone');
  assert.equal(v.fonteId, '8201530003');
  assert.equal(v.dataPublicacao, '2026-11-12T11:02:23.000Z');
  assert.equal(v.modelo, 'hibrido');
  assert.equal(v.cidadeSlug, 'sao-paulo');
  assert.equal((v.bruto as { content?: string }).content, undefined);
});

test('modelo da descrição: só o declarado; palavra solta de benefício não conta', () => {
  // Textos reais, 14/11.
  assert.equal(modeloDaDescricao('Modelo de Trabalho: Híbrido, com atuação presencial duas vezes por semana.\n#LI-ONSITE'), 'hibrido');
  assert.equal(modeloDaDescricao('Modelo de Trabalho Presencial Flexível'), 'presencial');
  assert.equal(modeloDaDescricao('• Modelo: Remoto (com encontros presenciais esporádicos)'), 'remoto');
  assert.equal(modeloDaDescricao('Atuamos no modelo remote-first , oferecendo total flexibilidade'), 'remoto');
  assert.equal(modeloDaDescricao('Nosso time de Farmer atua no modelo presencial , sendo necessário'), 'presencial');
  assert.equal(modeloDaDescricao('Requisitos...\n#LI-ONSITE (presencial)'), 'presencial');
  assert.equal(modeloDaDescricao('Disponibilidade para atuação 100% presencial na Faria Lima'), 'presencial');
  assert.equal(modeloDaDescricao('🏠 Auxílio home office * (apenas para contratos Híbridos ou Remotos)'), null);
  assert.equal(modeloDaDescricao('Flexibilidade: Auxílio Home Office e programa Work From Anywhere (WFA).'), null);
});

test('modelo: o título vence o local', () => {
  const v = normalizarItemGreenhouse({ ...ITEM, title: 'Analista Sênior de Tesouraria | (Presencial/SP)', location: { name: 'Remoto' } }, QUADRO)!;
  assert.equal(v.modelo, 'presencial');
});

test('encerramento: id sumido do quadro encerra, id de volta reabre', () => {
  const linhas = [
    { id: 1, dedup_key: 'ats_greenhouse:100', encerrada_em: null },
    { id: 2, dedup_key: 'ats_greenhouse:200@sao-paulo', encerrada_em: null },
    { id: 3, dedup_key: 'ats_greenhouse:300', encerrada_em: '2026-11-10T00:00:00Z' },
  ];
  assert.deepEqual(decidirEncerramento(linhas, new Set(['100', '300'])), { encerrar: [2], reabrir: [3] });
});

test('item sem data ou sem local que sirva não vira vaga', () => {
  assert.equal(normalizarItemGreenhouse({ ...ITEM, first_published: null }, QUADRO), null);
  assert.equal(normalizarItemGreenhouse({ ...ITEM, location: { name: 'Miami, FL' } }, QUADRO), null);
});

test('URL canônica: os dois hosts do Greenhouse viram a mesma', () => {
  const a = canonicalizarUrl('https://job-boards.greenhouse.io/stone/jobs/8201530003?gh_src=abc');
  const b = canonicalizarUrl('https://boards.greenhouse.io/stone/jobs/8201530003');
  assert.equal(a?.url, 'https://job-boards.greenhouse.io/stone/jobs/8201530003');
  assert.equal(a?.url, b?.url);
  assert.equal(a?.fonte, 'ats_greenhouse');
  assert.equal(a?.fonteId, '8201530003');
});

const responder = (status: number, corpo: unknown) =>
  (async () => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status })) as unknown as typeof fetch;

test('quadro: filtra pela janela, mas lista todos os ids', async () => {
  const velho = { ...ITEM, id: 1, first_published: '2026-09-01T00:00:00Z' };
  const r = await buscarNoGreenhouse(QUADRO, new Date('2026-11-07T00:00:00Z'), responder(200, { jobs: [ITEM, velho] }));
  assert.equal(r.falhou, false);
  assert.equal(r.vagas.length, 1);
  assert.equal(r.vistos, 2);
  assert.deepEqual(r.idsNoQuadro, ['8201530003', '1']);
});

test('quadro caído não é quadro vazio (achado 24)', async () => {
  const desde = new Date('2026-11-07T00:00:00Z');
  assert.equal((await buscarNoGreenhouse(QUADRO, desde, responder(404, ''))).falhou, true);
  assert.equal((await buscarNoGreenhouse(QUADRO, desde, responder(200, '<html>'))).falhou, true);
  const vazio = await buscarNoGreenhouse(QUADRO, desde, responder(200, { jobs: [] }));
  assert.equal(vazio.falhou, false);
  assert.equal(vazio.vagas.length, 0);
});
