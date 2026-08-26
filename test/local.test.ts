import test from 'node:test';
import assert from 'node:assert/strict';
import { modeloDoTexto, normalizarLocal, slugCidade, ufDe } from '../src/normalize/local.ts';

/**
 * As entradas destes testes são as grafias REAIS que o classificador gravou nas
 * 197 linhas de 24/08. Inventar variação aqui mediria a imaginação; o que
 * importa é o que o modelo escreve de fato.
 */
test('colapsa as grafias de São Paulo que apareceram em produção', () => {
  const grafias = [
    'São Paulo, SP',
    'São Paulo',
    'São Paulo - SP',
    'São Paulo/SP',
    'São Paulo, Brasil',
    'São Paulo e Região',
    'São Paulo / SP',
    'São Paulo, São Paulo',
    'São Paulo/BR',
    'Vila Mariana – São Paulo/SP',
  ];
  for (const grafia of grafias) {
    assert.equal(normalizarLocal(grafia).cidadeSlug, 'sao-paulo', grafia);
  }
});

test('cidade e estado homônimos: a cidade é a parte que não é o estado', () => {
  assert.deepEqual(normalizarLocal('Osasco, São Paulo, Brazil'), {
    cidadeSlug: 'osasco',
    uf: 'SP',
    paisBr: true,
  });
  assert.deepEqual(normalizarLocal('Piracicaba, São Paulo'), {
    cidadeSlug: 'piracicaba',
    uf: 'SP',
    paisBr: true,
  });
});

test('"São Paulo" sozinho é a cidade, não só o estado', () => {
  assert.deepEqual(normalizarLocal('São Paulo'), {
    cidadeSlug: 'sao-paulo',
    uf: 'SP',
    paisBr: true,
  });
});

test('remoto sem cidade: Brasil confirmado, cidade nenhuma', () => {
  for (const bruto of ['Brasil', 'Todo Brasil']) {
    const local = normalizarLocal(bruto);
    assert.equal(local.paisBr, true, bruto);
    assert.equal(local.cidadeSlug, null, bruto);
  }
});

/**
 * As três linhas que hoje estão no banco e não deveriam estar. O portão de
 * local do classificador não rodou nelas; esta camada é a segunda linha de
 * defesa, e é determinística.
 */
test('marca como fora do Brasil o que entrou no banco antes do portão', () => {
  assert.equal(normalizarLocal('Green Bay, Wisconsin').paisBr, false);
  assert.equal(normalizarLocal('Federal District, Venezuela').paisBr, false);
  assert.equal(normalizarLocal('France').paisBr, false);
});

test('nenhuma delas casa com a cidade de quem buscou São Paulo', () => {
  for (const bruto of ['Green Bay, Wisconsin', 'Federal District, Venezuela', 'France']) {
    assert.notEqual(normalizarLocal(bruto).cidadeSlug, 'sao-paulo', bruto);
  }
});

/**
 * A assimetria do módulo: cidade brasileira que o texto não qualifica fica
 * `null`, não `false`. Chutar `false` aqui esconderia vaga boa — "Iguatu" é no
 * Ceará e o anúncio simplesmente não disse.
 */
test('cidade sozinha e não reconhecida fica indefinida, não estrangeira', () => {
  const local = normalizarLocal('Iguatu');
  assert.equal(local.paisBr, null);
  assert.equal(local.cidadeSlug, 'iguatu');
});

test('localização ausente não inventa nada', () => {
  for (const vazio of [null, undefined, '', '   ']) {
    assert.deepEqual(normalizarLocal(vazio), { cidadeSlug: null, uf: null, paisBr: null });
  }
});

test('UF pela sigla e pelo nome por extenso', () => {
  assert.equal(ufDe('MG'), 'MG');
  assert.equal(ufDe('minas gerais'), 'MG');
  assert.equal(ufDe('Espírito Santo'), 'ES');
  assert.equal(ufDe('Wisconsin'), null);
});

test('o slug é o mesmo dos dois lados do filtro', () => {
  assert.equal(slugCidade('São Paulo'), 'sao-paulo');
  assert.equal(slugCidade('  belo   horizonte '), 'belo-horizonte');
  assert.equal(slugCidade('São Paulo'), normalizarLocal('São Paulo, SP').cidadeSlug);
});

/**
 * O modelo de trabalho estava null em 58% das linhas. Estes são títulos reais
 * da coleta — o sinal estava escrito e não era lido.
 */
test('lê o modelo de trabalho do título quando o LLM não disse', () => {
  assert.equal(modeloDoTexto('Nova Vaga Home Office: Product Manager Jr'), 'remoto');
  assert.equal(modeloDoTexto('Analista de Dados Pl - São Paulo (Híbrido)'), 'hibrido');
  assert.equal(modeloDoTexto('Data Product Manager (Híbrida em BH) - #78'), 'hibrido');
  assert.equal(modeloDoTexto('Desenvolvedor Front-end ou Pleno [100% remoto]'), 'remoto');
  assert.equal(modeloDoTexto('Engenheiro de Dados - Trabalho Remoto'), 'remoto');
});

test('híbrido vence remoto: "Híbrido ou Remoto" é oferta de híbrido', () => {
  assert.equal(
    modeloDoTexto('Locaweb | Especialista de Produto (Product Manager) | Híbrido ou Remoto'),
    'hibrido',
  );
});

test('sem termo explícito não chuta modelo', () => {
  assert.equal(modeloDoTexto('Product Manager'), null);
  assert.equal(modeloDoTexto('Auxiliar Administrativo - SAME'), null);
  assert.equal(modeloDoTexto(null, undefined, ''), null);
});

/** Os dois buracos que a reclassificação de 25/08 expôs em dado de produção. */
test('cidade colada na sigla por hífen, sem espaços', () => {
  assert.deepEqual(normalizarLocal('Jacareí-SP'), {
    cidadeSlug: 'jacarei',
    uf: 'SP',
    paisBr: true,
  });
});

test('hífen genérico não parte nome de cidade', () => {
  assert.equal(normalizarLocal('Mogi-Guaçu').cidadeSlug, 'mogi-guacu');
  assert.equal(normalizarLocal('Santa Bárbara d-Oeste').cidadeSlug, 'santa-barbara-d-oeste');
});

test('"Território Nacional" é Brasil inteiro, não uma cidade', () => {
  for (const bruto of ['Território Nacional', 'Todo o Território Nacional']) {
    assert.deepEqual(normalizarLocal(bruto), { cidadeSlug: null, uf: null, paisBr: true }, bruto);
  }
});
