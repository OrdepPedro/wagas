import test from 'node:test';
import assert from 'node:assert/strict';
import { consultaDeFeed } from '../src/feed/consulta.ts';
import { cargoBateNoTitulo, classesDeFamilia, tokensDeFamilia } from '../src/classificar/familia.ts';

const AGORA = new Date('2026-08-25T12:00:00Z');

function fazer(cargo: string, cidade: string) {
  return consultaDeFeed({ cargo, cidade, agora: AGORA });
}

/**
 * O ponto do teste não é a string: é que os dois lados do filtro usem a mesma
 * regra. O classificador grava com `tokensDeFamilia`; o feed consulta com
 * `filtroDeFamilia`. Se as duas divergirem, o sintoma em produção é feed vazio
 * sem causa aparente — o pior modo de falha possível para este produto.
 */
function casaNoPostgres(cargoBuscado: string, tituloDaVaga: string): boolean {
  const { dominio, classes } = fazer(cargoBuscado, 'São Paulo');
  const tokens = new Set(tokensDeFamilia(tituloDaVaga));
  const classesDaVaga = classesDeFamilia(tituloDaVaga);

  const contem = dominio.every((t) => tokens.has(t)); // familia_tokens @> dominio
  const cruza = classes.length === 0 || classesDaVaga.length === 0 // familia_classes && classes
    || classesDaVaga.some((c) => classes.includes(c));
  return contem && cruza;
}

test('o filtro do Postgres decide igual ao casamento em TypeScript', () => {
  const casos: Array<[string, string]> = [
    ['Product Manager', 'Product Manager Sênior'],
    ['Product Manager', 'Product Owner Junior'],
    ['Product Manager', 'Growth Product Manager'],
    ['Product Manager', 'Product Designer'],
    ['Product Manager', 'Project Manager'],
    ['Product Manager', 'Líder de Produtos Financeiros'],
    ['Analista de Dados', 'Cientista de Dados Pleno'],
    ['Analista de Dados', 'Desenvolvedor Front-end'],
    ['Auxiliar Administrativo', 'Assistente Administrativo I'],
    ['Enfermeiro', 'Enfermeiro III - Internação'],
    ['Enfermeiro', 'Auxiliar Administrativo'],
    ['Desenvolvedor Front-end', 'Desenvolvedor Front-end React - Pleno'],
  ];

  for (const [busca, titulo] of casos) {
    assert.equal(
      casaNoPostgres(busca, titulo),
      cargoBateNoTitulo(busca, titulo).bate,
      `${busca} x ${titulo}`,
    );
  }
});

test('a adjacência de cargo sobrevive à tradução para SQL', () => {
  assert.equal(casaNoPostgres('Product Manager', 'Product Owner Junior'), true);
  assert.equal(casaNoPostgres('Product Manager', 'Product Designer'), false);
});

test('cargo sem função reconhecida não restringe por classe', () => {
  const { classes, dominio } = fazer('Enfermeiro', 'São Paulo');
  assert.deepEqual(classes, []);
  assert.deepEqual(dominio, ['enfermeiro']);
});

test('a composição de local é a promessa do produto, não uma preferência', () => {
  const { query } = fazer('Product Manager', 'São Paulo');
  // cidade dele OU remoto que não seja comprovadamente de fora
  assert.match(query, /or\(cidade_slug\.eq\.sao-paulo,and\(modelo\.eq\.remoto,pais_br\.not\.is\.false\)\)/);
});

test('a janela de 7 dias entra como predicado, não como ordenação', () => {
  const { query, desde } = fazer('Product Manager', 'São Paulo');
  assert.equal(desde, '2026-08-18T12:00:00.000Z');
  assert.ok(query.includes(`data_referencia=gte.${desde}`));
  assert.ok(query.includes('ativo=is.true'));
});

test('cidade digitada de qualquer jeito vira o mesmo slug do dado gravado', () => {
  for (const escrita of ['São Paulo', 'sao paulo', '  SÃO PAULO  ']) {
    assert.equal(fazer('Product Manager', escrita).cidadeSlug, 'sao-paulo');
  }
});

/**
 * A regra crítica do CLAUDE.md: nada no caminho do request do usuário toca
 * numa API paga. Este teste falha se alguém acrescentar uma chamada aqui.
 */
test('a consulta do feed não conhece nenhuma fonte externa', async () => {
  const fs = await import('node:fs/promises');
  const bruto = await fs.readFile(new URL('../src/feed/consulta.ts', import.meta.url), 'utf8');
  // Comentário fora: o cabeçalho do módulo CITA a Serper para explicar por que
  // ela não pode ser chamada daqui. Medir o texto do comentário mediria a
  // documentação, não o código.
  const codigo = bruto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  for (const proibido of ['serper', 'fetch', 'http']) {
    assert.ok(!codigo.toLowerCase().includes(proibido), `consulta.ts usa ${proibido}`);
  }
});
