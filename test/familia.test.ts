import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cargoBateNoTitulo,
  decompor,
  senioridadeDoTitulo,
  tokenizar,
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
