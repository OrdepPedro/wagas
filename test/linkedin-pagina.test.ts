import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dataRelativaDoLinkedin,
  lerPaginaDoLinkedin,
  textoDeDataDaPagina,
} from '../src/fontes/linkedin-pagina.ts';

const AGORA = new Date('2026-10-27T12:00:00Z');
const DIA = 86_400_000;

/** Trecho real da página (27/10/2026): topo da vaga e um cartão da lateral. */
const PAGINA = `
  <h1 class="top-card-layout__title topcard__title">Especialista de Marketplace</h1>
  <span class="posted-time-ago__text topcard__flavor--metadata">
      Há 5 dias
        </span>
  <time class="aside-job-card__listdate" datetime="2026-07-22">Há 3 meses</time>`;

test('lê a data do topo da vaga, não da lateral', () => {
  assert.equal(textoDeDataDaPagina(PAGINA), 'Há 5 dias');
});

test('converte as unidades da data relativa', () => {
  const dias = (t: string) => (AGORA.getTime() - Date.parse(dataRelativaDoLinkedin(t, AGORA)!)) / DIA;
  assert.equal(dias('Há 5 dias'), 5);
  assert.equal(dias('Há 1 dia'), 1);
  assert.equal(dias('Há 2 semanas'), 14);
  assert.equal(dias('Há 2 meses'), 60);
  assert.equal(dias('Há 23 horas'), 23 / 24);
  assert.equal(dias('3 days ago'), 3);
});

test('texto sem número ou unidade desconhecida não vira data', () => {
  assert.equal(dataRelativaDoLinkedin('Recentemente', AGORA), null);
  assert.equal(dataRelativaDoLinkedin('Há 3 luas', AGORA), null);
});

const resposta = (status: number, corpo = '') =>
  (async () => new Response(corpo, { status })) as unknown as typeof fetch;

test('página com data vira datada', async () => {
  const l = await lerPaginaDoLinkedin('u', AGORA, resposta(200, PAGINA));
  assert.equal(l.tipo, 'datada');
});

test('página sem o bloco de data é sem_data, não falha', async () => {
  const l = await lerPaginaDoLinkedin('u', AGORA, resposta(200, '<html></html>'));
  assert.equal(l.tipo, 'sem_data');
});

test('429 e erro de rede são falha, não ausência de data', async () => {
  assert.equal((await lerPaginaDoLinkedin('u', AGORA, resposta(429))).tipo, 'falhou');
  const quebrado = (async () => {
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch;
  assert.equal((await lerPaginaDoLinkedin('u', AGORA, quebrado)).tipo, 'falhou');
});

test('404 é vaga removida', async () => {
  assert.equal((await lerPaginaDoLinkedin('u', AGORA, resposta(404))).tipo, 'removida');
});
