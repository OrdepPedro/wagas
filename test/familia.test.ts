import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';

import {
  cargoBateNoTitulo,
  decompor,
  senioridadeDoTitulo,
  tokenizar,
  chaveDeFamilia,
  semSenioridade,
} from '../src/classificar/familia.ts';

describe('decompor', () => {
  it('separa função, senioridade e domínio', () => {
    const n = decompor('Product Manager Sênior');
    assert.deepEqual(
      n.funcoes.map((f) => f.token),
      ['manager'],
    );
    assert.deepEqual(n.senioridade, ['senior']);
    assert.deepEqual(n.dominio, ['product']);
  });

  it('profissão de palavra única vira domínio inteiro', () => {
    // Sem isso a regra não teria o que exigir do título e passaria qualquer coisa.
    assert.deepEqual(decompor('Enfermeiro').dominio, ['enfermeiro']);
    assert.deepEqual(decompor('Enfermeiro').funcoes, []);
  });

  it('descarta o ruído que toda vaga carrega', () => {
    const n = decompor('Vaga Home Office: Analista de Dados - Trabalho Remoto');
    assert.deepEqual(n.dominio, ['data']);
    assert.deepEqual(
      n.funcoes.map((f) => f.token),
      ['analista'],
    );
  });

  it('"Enfermeiro(a)" não vira dois domínios', () => {
    assert.deepEqual(decompor('Enfermeiro(a) Auditor(a)').dominio, ['enfermeiro', 'auditor']);
  });
});

describe('tokenizar', () => {
  it('normaliza acento, caixa e hífen', () => {
    assert.deepEqual(tokenizar('Análise SÊNIOR - front-end'), ['analise', 'senior', 'frontend']);
  });

  it('aproxima português e inglês onde a palavra é a mesma coisa', () => {
    assert.ok(tokenizar('Especialista de Produto').includes('product'));
    assert.ok(tokenizar('Analista de Dados').includes('data'));
  });
});

describe('cargoBateNoTitulo', () => {
  it('aceita a mesma vaga com senioridade diferente', () => {
    assert.ok(cargoBateNoTitulo('Product Manager', 'Product Manager Sênior - Legitimuz').bate);
    assert.ok(cargoBateNoTitulo('Product Manager', 'Associate Product Manager Júnior').bate);
  });

  it('aceita cargo adjacente: Product Owner numa busca por Product Manager', () => {
    // Decisão de produto do CLAUDE.md, valendo por regra de família e não por
    // exceção escrita à mão para este par de cargos.
    assert.ok(cargoBateNoTitulo('Product Manager', 'Product Owner Sênior | Crédito - Porto').bate);
  });

  it('a mesma regra genérica vale para outro segmento', () => {
    // Nada no léxico cita "auxiliar administrativo": a adjacência sai de
    // auxiliar e assistente serem a mesma classe de função.
    assert.ok(cargoBateNoTitulo('Auxiliar Administrativo', 'Assistente Administrativo Jr').bate);
    assert.ok(cargoBateNoTitulo('Analista de Dados', 'Cientista de Dados - Trabalho Remoto').bate);
  });

  it('recusa mesmo domínio com outra função', () => {
    const r = cargoBateNoTitulo('Product Manager', 'VAGA: Product Designer 100% Remoto');
    assert.equal(r.bate, false);
    assert.equal(r.motivo, 'funcao_de_outra_classe');
  });

  it('recusa quando o domínio não aparece no título', () => {
    const r = cargoBateNoTitulo('Product Manager', 'Especialista II SAP EWM - Grupo Boticário');
    assert.equal(r.bate, false);
    assert.equal(r.motivo, 'dominio_ausente');

    assert.equal(cargoBateNoTitulo('Product Manager', 'Líder de projetos e pessoas').bate, false);
    assert.equal(cargoBateNoTitulo('Analista de Dados', 'Analista de Marketing Sênior').bate, false);
  });

  it('casa título em inglês com busca em português', () => {
    assert.ok(
      cargoBateNoTitulo('Desenvolvedor Front-end', 'Fluke Corporation hiring Front End Web Developer')
        .bate,
    );
  });

  it('título sem função reconhecida passa: cortar ali derrubaria vaga demais', () => {
    assert.ok(cargoBateNoTitulo('Enfermeiro', 'Enfermeiro - Clínica Mac Weber').bate);
    assert.ok(cargoBateNoTitulo('Analista de Dados', 'Analista de Dados SR').bate);
  });

  it('deixa passar o falso positivo conhecido — é o LLM que derruba', () => {
    // "[TEAM PRODUCT] Flutter flow Lead PL" tem `product` e tem `lead`: passa
    // nas duas condições. O pré-filtro erra para o lado do recall de propósito,
    // e o harness é quem mede o preço disso.
    assert.ok(cargoBateNoTitulo('Product Manager', '[TEAM PRODUCT] Flutter flow Lead PL - REMOTO').bate);
  });
});

describe('senioridadeDoTitulo', () => {
  it('lê a forma por extenso e a abreviada', () => {
    assert.equal(senioridadeDoTitulo('Analista de Dados SR'), 'senior');
    assert.equal(senioridadeDoTitulo('Product Manager Jr — Vaga Home Office'), 'junior');
    assert.equal(senioridadeDoTitulo('ATENTO - Analista de Dados Pl - Híbrido'), 'pleno');
  });

  it('a palavra ganha do numeral romano', () => {
    // "Enfermeiro III - Internação - 12x36" não é sênior por causa da numeração
    // interna do hospital; quando há palavra, ela manda.
    assert.equal(senioridadeDoTitulo('Product Manager Sênior I'), 'senior');
    assert.equal(senioridadeDoTitulo('Especialista II SAP EWM'), 'pleno');
  });

  it('devolve null quando o título não diz', () => {
    assert.equal(senioridadeDoTitulo('Enfermeiro - Clínica Mac Weber'), null);
  });
});

/**
 * A chave de agrupamento da DEMANDA. Nasceu de um defeito medido: o usuário
 * digitou "Enfermagem", "Enfermeira" e "Enfermeiro" na mesma sessão e a fila de
 * priorização mostrou três pedidos de uma pessoa cada.
 */
test('gênero gramatical não fragmenta a fila de demanda', () => {
  assert.equal(chaveDeFamilia('Enfermeira'), chaveDeFamilia('Enfermeiro'));
  assert.equal(chaveDeFamilia('Vendedora'), chaveDeFamilia('Vendedor'));
  assert.equal(chaveDeFamilia('Assistente Administrativa'), chaveDeFamilia('Auxiliar Administrativo'));
});

test('cargo adjacente cai no mesmo balde da fila', () => {
  assert.equal(chaveDeFamilia('Gerente de Produto'), chaveDeFamilia('Product Manager'));
  assert.equal(chaveDeFamilia('Analista de dados sênior'), chaveDeFamilia('Analista de Dados'));
});

/** A regra é por sufixo, não `-a` -> `-o`: senão "analista" vira lixo. */
test('não estraga cargo terminado em -ista', () => {
  assert.ok(chaveDeFamilia('Analista de Dados').startsWith('data|'));
  assert.notEqual(chaveDeFamilia('Motorista'), chaveDeFamilia('Motoristo'));
});

/** Profissão que é só função não pode colapsar a classe inteira num balde. */
test('cargos comerciais distintos não viram o mesmo pedido', () => {
  assert.notEqual(chaveDeFamilia('Vendedor'), chaveDeFamilia('SDR'));
});

/** O que a regra NÃO resolve, dito em teste para não virar surpresa. */
test('área e profissão continuam separadas: enfermagem não é enfermeiro', () => {
  assert.notEqual(chaveDeFamilia('Enfermagem'), chaveDeFamilia('Enfermeiro'));
});

/**
 * Nasceu de um falso negativo real: o Pedro buscou "Senior UX Designer" e o
 * feed veio vazio. A fonte casa por SUBSTRING, e a senioridade no termo
 * estreitava a busca na origem — 3 itens contra 7 sem ela.
 */
test('tira a senioridade do termo, preservando a ordem das palavras', () => {
  assert.equal(semSenioridade('Senior UX Designer'), 'UX Designer');
  assert.equal(semSenioridade('UX Designer Sênior'), 'UX Designer');
  assert.equal(semSenioridade('Auxiliar Administrativo'), 'Auxiliar Administrativo');
});

/**
 * O texto vai para uma fonte que casa por SUBSTRING, então as variantes
 * lexicais de `tokenizar` (dados -> data) NÃO podem ser aplicadas aqui:
 * "analista de data" não casa "Analista de Dados".
 */
test('preserva a grafia original, sem aplicar variantes', () => {
  assert.equal(semSenioridade('Analista de Dados Pleno'), 'Analista de Dados');
  assert.equal(semSenioridade('Gerente de Produtos'), 'Gerente de Produtos');
});

/** Ordem importa: "administrativo auxiliar" não casaria "Auxiliar Administrativo". */
test('não reordena o que sobrou', () => {
  assert.equal(semSenioridade('Auxiliar Administrativo Jr'), 'Auxiliar Administrativo');
});

/** Cargo que é só senioridade não pode virar string vazia e buscar tudo. */
test('nunca devolve vazio', () => {
  assert.notEqual(semSenioridade('Sênior'), '');
  assert.notEqual(semSenioridade('Trainee'), '');
});
