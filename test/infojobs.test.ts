import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarNoInfojobs,
  dataDoInfojobs,
  jobPostingDaPagina,
  linksDaListagem,
  normalizarJobPosting,
  urlDeBusca,
} from '../src/fontes/infojobs.ts';
import { canonicalizarUrl } from '../src/normalize/url.ts';

const AGORA = new Date('2026-10-20T12:00:00Z');
const URL_VAGA = 'https://www.infojobs.com.br/vaga-de-analista-dados-em-sao-paulo__12110964.aspx';

/** `JobPosting` real do InfoJobs (20/10/2026), com a descrição encurtada. */
function jobPosting(extra: Record<string, unknown> = {}) {
  return {
    '@context': 'http://schema.org',
    '@type': 'JobPosting',
    employmentType: 'Jornada completa',
    title: 'Analista de Dados Computacional',
    description:
      'Senioridade: Analista<br>Lugar de trabalho: São Paulo, SP<br>Regime de contratação de tipo Efetivo – CLT',
    datePosted: '2026-10-18T14:23:00.0000000',
    hiringOrganization: { '@type': 'Organization', name: 'Manpower' },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressCountry: 'BR', addressLocality: 'São Paulo', addressRegion: 'SP' },
    },
    ...extra,
  };
}

function paginaDeVaga(jp: Record<string, unknown> | null): string {
  const ld = jp ? `<script type="application/ld+json">${JSON.stringify(jp)}</script>` : '';
  return `<html><head>${ld}</head><body>Presencial</body></html>`;
}

function listagem(ids: number[]): string {
  return ids.map((id) => `<a href="/vaga-de-algo-em-sao-paulo__${id}.aspx">x</a>`).join('\n');
}

/** Fetch de mentira: listagens por número de página, vagas por id. Sem mapa = 404. */
function fetchFalso(paginas: Record<number, string>, vagas: Record<string, string>): typeof fetch {
  return (async (url: string) => {
    const u = String(url);
    const pagina = /Page=(\d+)/.exec(u);
    const corpo = pagina ? paginas[Number(pagina[1])] : vagas[/__(\d+)\.aspx/.exec(u)?.[1] ?? ''];
    return corpo === undefined ? new Response('', { status: 404 }) : new Response(corpo, { status: 200 });
  }) as unknown as typeof fetch;
}

test('a paginação usa `Page` maiúsculo e por último — `page` é ignorado pelo site', () => {
  const u = urlDeBusca('Auxiliar Administrativo', 'São Paulo', 3);
  assert.equal(u, 'https://www.infojobs.com.br/vagas-de-emprego-auxiliar+administrativo-em-sao-paulo.aspx?campo=griddate&orden=desc&Page=3');
});

test('a data sem fuso é horário de Brasília, não UTC', () => {
  assert.equal(dataDoInfojobs('2026-10-13T14:23:00.0000000'), '2026-10-13T17:23:00.000Z');
  assert.equal(dataDoInfojobs('2026-10-13T14:23:00Z'), '2026-10-13T14:23:00.000Z');
  assert.equal(dataDoInfojobs(''), null);
  assert.equal(dataDoInfojobs(undefined), null);
});

test('extrai empresa, cidade, data e descrição do JobPosting', () => {
  const v = normalizarJobPosting(jobPosting(), URL_VAGA)!;
  assert.equal(v.empresa, 'Manpower');
  assert.equal(v.cidadeSlug, 'sao-paulo');
  assert.equal(v.uf, 'SP');
  assert.equal(v.fonteId, '12110964');
  assert.equal(v.dataPublicacao, '2026-10-18T17:23:00.000Z');
  assert.match(v.descricao!, /Lugar de trabalho: São Paulo, SP\nRegime/);
});

test('o modelo sai do texto da vaga, nunca do resto da página', () => {
  // A página diz "Presencial" fora do JobPosting; isso não pode virar o modelo.
  const jp = jobPostingDaPagina(paginaDeVaga(jobPosting()))!;
  assert.equal(normalizarJobPosting(jp, URL_VAGA)!.modelo, null);
  assert.equal(normalizarJobPosting(jobPosting({ title: 'Analista de Dados - Home Office' }), URL_VAGA)!.modelo, 'remoto');
  assert.equal(normalizarJobPosting(jobPosting({ jobLocationType: 'TELECOMMUTE' }), URL_VAGA)!.modelo, 'remoto');
});

test('JobPosting sem título, sem data ou URL sem id não é aproveitável', () => {
  assert.equal(normalizarJobPosting(jobPosting({ title: '' }), URL_VAGA), null);
  assert.equal(normalizarJobPosting(jobPosting({ datePosted: '' }), URL_VAGA), null);
  assert.equal(normalizarJobPosting(jobPosting(), 'https://www.infojobs.com.br/empresa.aspx'), null);
});

test('links da listagem saem sem repetição e na ordem', () => {
  const html = listagem([1, 2, 1, 3]);
  assert.deepEqual(
    linksDaListagem(html).map((u) => /__(\d+)/.exec(u)![1]),
    ['1', '2', '3'],
  );
});

test('a URL canoniza pelo id e marca a fonte', () => {
  const c = canonicalizarUrl(URL_VAGA + '?utm_source=x')!;
  assert.equal(c.fonte, 'portal_infojobs');
  assert.equal(c.fonteId, '12110964');
  assert.equal(c.url, URL_VAGA);
});

test('filtra família, janela e local — e conta cada corte', async () => {
  const vagas = {
    '1': paginaDeVaga(jobPosting()),
    '2': paginaDeVaga(jobPosting({ title: 'Analista Fiscal' })),
    '3': paginaDeVaga(jobPosting({ jobLocation: { address: { addressLocality: 'Recife', addressRegion: 'PE' } } })),
    '4': paginaDeVaga(null),
    '5': paginaDeVaga(jobPosting({ datePosted: '2026-09-01T10:00:00.0000000' })),
  };
  const r = await buscarNoInfojobs({
    cargo: 'Analista de Dados',
    cidade: 'São Paulo',
    agora: AGORA,
    intervaloMs: 0,
    buscar: fetchFalso({ 1: listagem([1, 2, 3, 4, 5]) }, vagas),
  });
  assert.equal(r.falhou, false);
  assert.deepEqual(r.vagas.map((v) => v.fonteId), ['1']);
  assert.equal(r.outraFamilia, 1);
  assert.equal(r.localNaoServe, 1);
  assert.equal(r.semJobPosting, 1);
  assert.equal(r.foraDaJanela, 1);
});

test('para depois de 5 vagas seguidas fora da janela, sem abrir a página seguinte', async () => {
  const velha = paginaDeVaga(jobPosting({ datePosted: '2026-09-01T10:00:00.0000000' }));
  let listagensPedidas = 0;
  const base = fetchFalso({ 1: listagem([1, 2, 3, 4, 5, 6]), 2: listagem([7]) }, Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [String(i), velha])));
  const buscar = (async (url: string) => {
    if (/Page=/.test(url)) listagensPedidas++;
    return base(url);
  }) as unknown as typeof fetch;

  const r = await buscarNoInfojobs({ cargo: 'Analista de Dados', cidade: 'São Paulo', agora: AGORA, intervaloMs: 0, buscar });
  assert.equal(r.foraDaJanela, 5);
  assert.equal(listagensPedidas, 1);
});

test('fonte caída não é fonte vazia', async () => {
  const caida = await buscarNoInfojobs({
    cargo: 'Analista de Dados', cidade: 'São Paulo', agora: AGORA, intervaloMs: 0,
    buscar: fetchFalso({}, {}),
  });
  assert.equal(caida.falhou, true);

  const vazia = await buscarNoInfojobs({
    cargo: 'Analista de Dados', cidade: 'São Paulo', agora: AGORA, intervaloMs: 0,
    buscar: fetchFalso({ 1: '<html>nenhuma vaga</html>' }, {}),
  });
  assert.equal(vazia.falhou, false);
  assert.equal(vazia.vagas.length, 0);
});
