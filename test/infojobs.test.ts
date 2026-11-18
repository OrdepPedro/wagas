import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blocoDaVaga,
  buscarNoInfojobs,
  cartoesDaListagem,
  dataDoCartao,
  dataRelativa,
  modeloDoBloco,
  vagaRemotaDoBloco,
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
  const u = urlDeBusca('Auxiliar Administrativo', 'São Paulo', 'SP', 3);
  assert.equal(u, 'https://www.infojobs.com.br/vagas-de-emprego-auxiliar+administrativo-em-sao-paulo,-sp.aspx?campo=griddate&orden=desc&Page=3');
});

test('cidade sem UF é recusada — o site trocaria a cidade pelo estado ou pelo Brasil, em silêncio', () => {
  // `sao-paulo` devolve o estado (7.252), `belo-horizonte` devolve o Brasil (16.256).
  assert.throws(() => urlDeBusca('Vendedor', 'Belo Horizonte', null, 1), /sem UF/);
  assert.throws(() => urlDeBusca('Vendedor', 'Belo Horizonte', 'Minas Gerais', 1), /sem UF/);
  assert.match(urlDeBusca('Vendedor', null, null, 1), /vagas-de-emprego-vendedor\.aspx/);
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
    cidade: 'São Paulo', uf: 'SP',
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

  const r = await buscarNoInfojobs({ cargo: 'Analista de Dados', cidade: 'São Paulo', uf: 'SP', agora: AGORA, intervaloMs: 0, buscar });
  assert.equal(r.foraDaJanela, 5);
  assert.equal(listagensPedidas, 1);
});

/**
 * Página "em Todo Brasil" sem JobPosting, no formato real (22/10/2026): bloco da
 * vaga, depois `divSimilarVacancies` com OUTRA vaga na lateral.
 */
function paginaTodoBrasil(opc: { icone?: string; data?: string; extraIcone?: string; semSeparador?: boolean } = {}): string {
  const icone = opc.icone ?? 'user-home';
  const lateral = opc.semSeparador
    ? ''
    : `<div id="divSimilarVacancies" class="col"><h3>Outras vagas similares</h3>
       <div class="text-medium small font-weight-bold mb-4"><svg class="icon icon-buildings"><use xlink:href="#buildings" /></svg> Presencial</div>
       <div class="caption text-medium text-nowrap text-right mb-8"> 1 jan </div>
       <h2 class="font-weight-bolder mb-4 js_vacancyHeaderTitle">VAGA DA LATERAL</h2></div>`;
  return `<html><body>
    <h2 class="font-weight-bolder mb-4 js_vacancyHeaderTitle">Desenvolvedor(A) Back-End</h2>
    <a href="https://www.infojobs.com.br/empresa-x.aspx" title="EMPREGGA TECNOLOGIA Trabalhe Conosco">EMPREGGA</a>
    <div class="text-medium mb-4"> Todo Brasil </div>
    ${opc.extraIcone ?? ''}
    <div class="text-medium small font-weight-bold mb-4"> <svg class="icon icon-${icone} icon-size-14"> <use xlink:href="#${icone}" /> </svg> ${icone === 'user-home' ? 'Home office' : 'Presencial'} </div>
    <div class="caption text-medium text-nowrap text-right mb-8"> ${opc.data ?? 'Ontem'} </div>
    <p class="mb-16 text-break white-space-pre-line">Vaga 100% remota &amp; PJ. Node.js e Postgres.</p>
    <p><span class="font-weight-bold">Tipo de contrato e Jornada:</span> Prestador de Servi&#xE7;os (PJ) - Per&#xED;odo Integral</p>
    ${lateral}
  </body></html>`;
}
const URL_REMOTA = 'https://www.infojobs.com.br/vaga-de-desenvolvedora-back-end-em-__12136000.aspx';

test('data do bloco: Hoje, Ontem e "20 out", com o ano inferido para trás', () => {
  const agora = new Date('2026-10-22T18:00:00Z'); // 15h em Brasília
  assert.equal(dataRelativa('Hoje', agora), '2026-10-22T15:00:00.000Z');
  assert.equal(dataRelativa('Ontem', agora), '2026-10-21T15:00:00.000Z');
  assert.equal(dataRelativa('20 out', agora), '2026-10-20T15:00:00.000Z');
  // Lido em 2 de janeiro, "28 dez" é do ano anterior, não do futuro.
  assert.equal(dataRelativa('28 dez', new Date('2027-01-02T12:00:00Z')), '2026-12-28T15:00:00.000Z');
  assert.equal(dataRelativa('há pouco', agora), null);
});

test('"Todo Brasil" com home office vira vaga remota, lida só do bloco da vaga', () => {
  const bloco = blocoDaVaga(paginaTodoBrasil())!;
  const v = vagaRemotaDoBloco(bloco, URL_REMOTA, AGORA)!;
  assert.equal(v.cargo, 'Desenvolvedor(A) Back-End');
  assert.equal(v.empresa, 'EMPREGGA TECNOLOGIA');
  assert.equal(v.modelo, 'remoto');
  assert.equal(v.localizacao, 'Todo Brasil');
  assert.equal(v.tipoContrato, 'Prestador de Serviços (PJ) - Período Integral');
  assert.equal(v.origemData, 'pagina_html');
  assert.equal(v.descricao, 'Vaga 100% remota & PJ. Node.js e Postgres.');
  // Nada da lateral entra: nem o título, nem a data "1 jan", nem o "Presencial".
  assert.doesNotMatch(bloco, /VAGA DA LATERAL/);
});

test('"Todo Brasil" presencial fica fora — não tem cidade para cair em feed nenhum', () => {
  const bloco = blocoDaVaga(paginaTodoBrasil({ icone: 'buildings' }))!;
  assert.equal(modeloDoBloco(bloco), 'presencial');
  assert.equal(vagaRemotaDoBloco(bloco, URL_REMOTA, AGORA), null);
});

test('o selo de PCD não é confundido com o modelo de trabalho', () => {
  const pcd = '<div class="text-medium small font-weight-bold mb-4"><svg class="icon icon-disability"><use xlink:href="#disability" /></svg> PCD</div>';
  const bloco = blocoDaVaga(paginaTodoBrasil({ extraIcone: pcd }))!;
  assert.equal(modeloDoBloco(bloco), 'remoto');
});

test('sem o marcador da lateral a página é recusada — não dá para saber onde a vaga acaba', () => {
  assert.equal(blocoDaVaga(paginaTodoBrasil({ semSeparador: true })), null);
});

test('a busca aproveita a remota sem JobPosting e conta a presencial "Todo Brasil" à parte', async () => {
  const r = await buscarNoInfojobs({
    cargo: 'Desenvolvedor Back-End', cidade: 'São Paulo', uf: 'SP', agora: AGORA, intervaloMs: 0,
    buscar: fetchFalso({ 1: listagem([1, 2]) }, {
      '1': paginaTodoBrasil(),
      '2': paginaTodoBrasil({ icone: 'buildings' }),
    }),
  });
  assert.deepEqual(r.vagas.map((v) => v.fonteId), ['1']);
  assert.equal(r.remotasDoBloco, 1);
  assert.equal(r.todoBrasilPresencial, 1);
  assert.equal(r.semJobPosting, 0);
});

test('fonte caída não é fonte vazia', async () => {
  const caida = await buscarNoInfojobs({
    cargo: 'Analista de Dados', cidade: 'São Paulo', uf: 'SP', agora: AGORA, intervaloMs: 0,
    buscar: fetchFalso({}, {}),
  });
  assert.equal(caida.falhou, true);

  const vazia = await buscarNoInfojobs({
    cargo: 'Analista de Dados', cidade: 'São Paulo', uf: 'SP', agora: AGORA, intervaloMs: 0,
    buscar: fetchFalso({ 1: '<html>nenhuma vaga</html>' }, {}),
  });
  assert.equal(vazia.falhou, false);
  assert.equal(vazia.vagas.length, 0);
});

// --- Cartões da listagem (18/11) ------------------------------------------------

/** Cartão no formato real da listagem (18/11/2026), encurtado. */
function cartao(id: number, titulo: string, data: string | null): string {
  const d = data === null ? '' : `<div hidden class="js_date" data-value="${data}"><span> NOVA </span></div>`;
  return `<div class="card js_rowCard">
    <div id="vacancy${id}" data-id="${id}" class="pt-24 px-24 cursor-pointer js_vacancyLoad js_cardLink" data-href="/vaga-de-algo-em-sao-paulo__${id}.aspx">
      <div class="d-flex">${d}</div>
      <a class="text-decoration-none" href="/vaga-de-algo-em-sao-paulo__${id}.aspx">
        <h2 class="h3 font-weight-bold text-body mb-2 js_vacancyTitle"> ${titulo} </h2></a>
      <div class="text-medium small text-nowrap"> Hoje </div>
    </div></div>`;
}

test('o cartão traz id, título decodificado e data de Brasília em UTC, sem vazar para o vizinho', () => {
  const html = cartao(1, 'Auxiliar Administrativo - Cachoeir&#xE3;o', '2026/10/19 08:58:00') + cartao(2, 'Recepcionista', null);
  assert.deepEqual(cartoesDaListagem(html), [
    { url: 'https://www.infojobs.com.br/vaga-de-algo-em-sao-paulo__1.aspx', id: '1', titulo: 'Auxiliar Administrativo - Cachoeirão', data: '2026-10-19T11:58:00.000Z' },
    // Sem data no cartão: null, não a data do cartão anterior.
    { url: 'https://www.infojobs.com.br/vaga-de-algo-em-sao-paulo__2.aspx', id: '2', titulo: 'Recepcionista', data: null },
  ]);
  assert.equal(dataDoCartao('2026/11/18 08:58'), '2026-11-18T11:58:00.000Z');
  assert.equal(dataDoCartao('18 nov'), null);
});

test('layout sem cartão reconhecível cai para os links soltos, sem título nem data', () => {
  assert.deepEqual(cartoesDaListagem(listagem([7])), [
    { url: 'https://www.infojobs.com.br/vaga-de-algo-em-sao-paulo__7.aspx', id: '7', titulo: null, data: null },
  ]);
});

test('o cartão corta outra família, vaga velha e id conhecido sem abrir a página', async () => {
  const abertas: string[] = [];
  const base = fetchFalso(
    { 1: [cartao(1, 'Analista de Dados', '2026/10/19 10:00:00'), cartao(2, 'Analista Fiscal', '2026/10/19 10:00:00'), cartao(3, 'Analista de Dados Pleno', '2026/10/19 09:00:00'), cartao(4, 'Analista de Dados', '2026/09/01 10:00:00')].join('') },
    { '1': paginaDeVaga(jobPosting()), '2': paginaDeVaga(jobPosting({ title: 'Analista Fiscal' })), '3': paginaDeVaga(jobPosting()), '4': paginaDeVaga(jobPosting()) },
  );
  const buscar = (async (url: string) => {
    const id = /__(\d+)\.aspx/.exec(url)?.[1];
    if (id) abertas.push(id);
    return base(url);
  }) as unknown as typeof fetch;

  const r = await buscarNoInfojobs({
    cargo: 'Analista de Dados', cidade: 'São Paulo', uf: 'SP', agora: AGORA, intervaloMs: 0,
    conhecidos: new Set(['3']), buscar,
  });
  assert.deepEqual(abertas, ['1']);
  assert.deepEqual(r.vagas.map((v) => v.fonteId), ['1']);
  assert.equal(r.outraFamilia, 1);
  assert.equal(r.foraDaJanela, 1);
  assert.equal(r.jaConhecidas, 1);
  assert.equal(r.cortadasNaListagem, 2);
  assert.equal(r.requisicoes, 3); // listagem 1, vaga 1, listagem 2 (vazia)
});

test('o cartão para a paginação depois de 5 velhos seguidos, sem abrir nenhuma vaga', async () => {
  const velhos = [1, 2, 3, 4, 5, 6].map((i) => cartao(i, 'Analista de Dados', '2026/09/01 10:00:00')).join('');
  const r = await buscarNoInfojobs({
    cargo: 'Analista de Dados', cidade: 'São Paulo', uf: 'SP', agora: AGORA, intervaloMs: 0,
    buscar: fetchFalso({ 1: velhos, 2: cartao(7, 'Analista de Dados', '2026/10/19 10:00:00') }, {}),
  });
  assert.equal(r.foraDaJanela, 5);
  assert.equal(r.requisicoes, 1);
});

test('a página ainda decide: título do cartão na família e JobPosting de outra família não passa', async () => {
  const r = await buscarNoInfojobs({
    cargo: 'Analista de Dados', cidade: 'São Paulo', uf: 'SP', agora: AGORA, intervaloMs: 0,
    buscar: fetchFalso({ 1: cartao(1, 'Analista de Dados', '2026/10/19 10:00:00') }, { '1': paginaDeVaga(jobPosting({ title: 'Analista Fiscal' })) }),
  });
  assert.equal(r.vagas.length, 0);
  assert.equal(r.outraFamilia, 1);
});

test('hora do cartão em relógio de 12h: perto do corte, o cartão não corta, a página decide', async () => {
  // Corte em 13/10 12h UTC. O cartão diz 02:00 (05:00 UTC), mas pode ser 14:00 (17:00 UTC).
  const r = await buscarNoInfojobs({
    cargo: 'Analista de Dados', cidade: 'São Paulo', uf: 'SP', agora: AGORA, intervaloMs: 0,
    buscar: fetchFalso({ 1: cartao(1, 'Analista de Dados', '2026/10/13 02:00:00') }, { '1': paginaDeVaga(jobPosting({ datePosted: '2026-10-13T14:00:00.0000000' })) }),
  });
  assert.deepEqual(r.vagas.map((v) => v.fonteId), ['1']);
  assert.equal(r.cortadasNaListagem, 0);
});
