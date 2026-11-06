import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chamadaPermitida, lerVagaColada, origemPermitida } from '../src/curriculo/vaga-colada.ts';

const DESCRICAO = 'Atividades: atendimento ao cliente, controle de estoque e emissão de notas. '.repeat(6);

describe('lerVagaColada', () => {
  it('aceita cargo + descrição completa e normaliza espaços', () => {
    const r = lerVagaColada({ cargo: '  Auxiliar   Administrativo ', empresa: ' Loja Azul ', descricao: DESCRICAO });
    assert.ok('vaga' in r);
    assert.equal(r.vaga.cargo, 'Auxiliar Administrativo');
    assert.equal(r.vaga.empresa, 'Loja Azul');
    assert.equal(r.hash.length, 32);
  });

  it('empresa é opcional', () => {
    const r = lerVagaColada({ cargo: 'Vendedor', descricao: DESCRICAO });
    assert.ok('vaga' in r);
    assert.equal(r.vaga.empresa, 'não informada');
  });

  it('recusa sem cargo', () => {
    assert.ok('erro' in lerVagaColada({ descricao: DESCRICAO }));
  });

  it('recusa descrição curta: sem corpo da vaga não há o que adaptar', () => {
    assert.ok('erro' in lerVagaColada({ cargo: 'Vendedor', descricao: 'Vaga de vendedor, salário a combinar.' }));
  });

  it('recusa entrada que não é objeto', () => {
    assert.ok('erro' in lerVagaColada(null));
    assert.ok('erro' in lerVagaColada('texto'));
  });

  it('mesma vaga colada com espaçamento diferente dá o mesmo hash', () => {
    const a = lerVagaColada({ cargo: 'Vendedor', descricao: DESCRICAO });
    const b = lerVagaColada({ cargo: ' vendedor ', descricao: `\n${DESCRICAO.replace(/ /g, '  ')}\n` });
    assert.ok('hash' in a && 'hash' in b);
    assert.equal(a.hash, b.hash);
  });

  it('descrição diferente dá hash diferente', () => {
    const a = lerVagaColada({ cargo: 'Vendedor', descricao: DESCRICAO });
    const b = lerVagaColada({ cargo: 'Vendedor', descricao: `${DESCRICAO} Requisito: CNH B.` });
    assert.ok('hash' in a && 'hash' in b);
    assert.notEqual(a.hash, b.hash);
  });
});

describe('chamadaPermitida', () => {
  const SITE = 'https://wagas.example';

  it('GET da extensão sem Origin (como o Chrome faz) passa com o cabeçalho', () => {
    assert.equal(chamadaPermitida(null, '1', SITE), true);
  });

  it('sem o cabeçalho próprio, recusa — mesmo com origem boa', () => {
    assert.equal(chamadaPermitida(null, null, SITE), false);
    assert.equal(chamadaPermitida(SITE, null, SITE), false);
  });

  it('com o cabeçalho e Origin de terceiro, recusa', () => {
    assert.equal(chamadaPermitida('https://malicioso.example', '1', SITE), false);
  });
});

describe('origemPermitida', () => {
  const ID = 'abcdefghijklmnopabcdefghijklmnop';
  const SITE = 'https://wagas.example';

  it('aceita o próprio site', () => {
    assert.equal(origemPermitida(SITE, SITE), true);
  });

  it('aceita extensão do Chrome quando o id não está fixado', () => {
    assert.equal(origemPermitida(`chrome-extension://${ID}`, SITE), true);
  });

  it('com id fixado, só aquela extensão', () => {
    assert.equal(origemPermitida(`chrome-extension://${ID}`, SITE, ID), true);
    assert.equal(origemPermitida(`chrome-extension://${'p'.repeat(32)}`, SITE, ID), false);
  });

  it('recusa site de terceiro e ausência de Origin', () => {
    assert.equal(origemPermitida('https://malicioso.example', SITE), false);
    assert.equal(origemPermitida(null, SITE), false);
    assert.equal(origemPermitida('chrome-extension://nao-e-id', SITE), false);
  });
});
