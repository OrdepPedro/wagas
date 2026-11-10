import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citaNaDescricao,
  regexDaDescricao,
  termoDeEngenharia,
  termosDaDescricao,
} from '../src/classificar/familia.ts';
import { consultaPorDescricao } from '../src/feed/consulta.ts';

const AGORA = new Date('2026-11-10T12:00:00Z');

test('o termo da descrição é o assunto da busca, sem função nem senioridade', () => {
  assert.deepEqual(termosDaDescricao('Python'), ['python']);
  assert.deepEqual(termosDaDescricao('Desenvolvedor Javascript Sênior'), ['javascript']);
  assert.deepEqual(termosDaDescricao('Desenvolvedor react junior'), ['react']);
  assert.deepEqual(termosDaDescricao('Power BI'), ['power', 'bi']);
  // Sem assunto, não há o que procurar no texto.
  assert.deepEqual(termosDaDescricao('Desenvolvedor Júnior'), []);
});

test('o termo da descrição NÃO passa pelas variantes de título', () => {
  // "dados" -> "data" serve para comparar títulos; em texto corrido, "data"
  // casaria "data de início" em toda descrição.
  assert.deepEqual(termosDaDescricao('Analista de Dados'), ['dados']);
});

test('a descrição cita a palavra inteira, não um pedaço dela', () => {
  assert.equal(citaNaDescricao(['java'], 'Domínio de JavaScript e TypeScript'), false);
  assert.equal(citaNaDescricao(['java'], 'Experiência com Java 11+ e Spring'), true);
  assert.equal(citaNaDescricao(['node'], 'back-end em Node.js e Express'), true);
  assert.equal(citaNaDescricao(['node'], 'automação com n8n e nodes de IA'), false);
  assert.equal(citaNaDescricao(['power', 'bi'], 'Excel, SQL e Power BI'), true);
  assert.equal(citaNaDescricao(['power', 'bi'], 'Power Automate'), false);
  assert.equal(citaNaDescricao([], 'qualquer coisa'), false);
});

/**
 * O feed procura com `imatch` no Postgres; o teste acima mede o espelho em
 * TypeScript. Os dois precisam concordar — a mesma lição de feed.test.ts: duas
 * implementações que divergem dão feed vazio sem causa aparente. Aqui a regex
 * do Postgres é traduzida para JavaScript (`\m`/`\M` viram fronteira de
 * palavra Unicode) e roda contra os mesmos textos.
 */
function casaNoPostgres(termos: string[], descricao: string): boolean {
  return termos.every((termo) => {
    const fonte = regexDaDescricao(termo)
      .replace(/^\\m/, '(?<![\\p{L}\\p{N}_])')
      .replace(/\\M$/, '(?![\\p{L}\\p{N}_])');
    return new RegExp(fonte, 'iu').test(descricao);
  });
}

test('a regex do Postgres decide igual ao espelho em TypeScript', () => {
  const casos: Array<[string, string]> = [
    ['Python', 'Programação fluente em Python (ou Go)'],
    ['Python', 'PYTHON, SQL e Airflow'],
    ['Java', 'Domínio de JavaScript'],
    ['Java', 'Java/Spring Boot'],
    ['Node', 'Node.js e Express'],
    ['Logística', 'experiência em LOGÍSTICA reversa'],
    ['Logística', 'experiência em logistica'],
    ['Licitação', 'processos de licitacao pública'],
    ['Power BI', 'Excel avançado e Power BI'],
    ['Power BI', 'Power Automate'],
  ];
  for (const [busca, descricao] of casos) {
    const termos = termosDaDescricao(busca);
    assert.equal(
      casaNoPostgres(termos, descricao),
      citaNaDescricao(termos, descricao),
      `${busca} × "${descricao}"`,
    );
  }
});

test('o termo só é de engenharia quando dois terços dos títulos dele são', () => {
  const eng = ['engenharia'];
  const outra = ['analise'];
  // Acervo sem o termo no título: não há evidência, não ativa.
  assert.equal(termoDeEngenharia([]), false);
  // Python medido em 10/11: 7 de 9.
  assert.equal(termoDeEngenharia([...Array(7).fill(eng), outra, outra]), true);
  // "Software", 50%: fica de fora.
  assert.equal(termoDeEngenharia([eng, outra]), false);
  // Exatamente dois terços: entra.
  assert.equal(termoDeEngenharia([eng, eng, outra]), true);
  // Marketing, Enfermeiro: nenhum título de engenharia.
  assert.equal(termoDeEngenharia([outra, [], ['operacao']]), false);
});

test('busca sem assunto não tem segunda via', () => {
  assert.equal(consultaPorDescricao({ cargo: 'Desenvolvedor', cidade: 'São Paulo', agora: AGORA }), null);
});

test('busca sem função aceita título de engenharia ou de análise', () => {
  const c = consultaPorDescricao({ cargo: 'Python', cidade: 'Todo o Brasil', soRemoto: true, agora: AGORA });
  assert.ok(c);
  assert.match(c.vagas, /familia_classes\.ov\.\{engenharia,analise\}/);
  // O que bate pelo título já veio na primeira consulta.
  assert.match(c.vagas, /familia_tokens=not\.cs\.\{python\}/);
  assert.match(c.vagas, /descricao=imatch\./);
  assert.match(c.titulos, /familia_tokens=cs\.\{python\}/);
});

test('busca com função exige título da mesma classe', () => {
  const c = consultaPorDescricao({ cargo: 'Desenvolvedor Javascript', cidade: 'Todo o Brasil', soRemoto: true, agora: AGORA });
  assert.ok(c);
  assert.match(c.vagas, /familia_classes\.ov\.\{engenharia\}/);
  assert.deepEqual(c.termos, ['javascript']);
});

test('o portão do acervo usa o domínio de título; a descrição, a palavra digitada', () => {
  const c = consultaPorDescricao({ cargo: 'Analista de Dados', cidade: 'São Paulo', agora: AGORA });
  assert.ok(c);
  assert.match(c.titulos, /familia_tokens=cs\.\{data\}/);
  assert.match(decodeURIComponent(c.vagas), /descricao=imatch\.\\md\[aáàâãä\]d/);
});

test('a segunda via respeita a mesma janela e o mesmo local do feed', () => {
  const c = consultaPorDescricao({ cargo: 'Python', cidade: 'Belo Horizonte', agora: AGORA });
  assert.ok(c);
  assert.match(c.vagas, /data_referencia=gte\.2026-11-03/);
  assert.match(c.vagas, /cidade_slug\.eq\.belo-horizonte/);
  assert.match(c.vagas, /encerrada_em=is\.null/);
});
