import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RespostaInvalida, verificarFidelidade, type CurriculoAdaptado } from '../src/curriculo/adaptar.ts';
import {
  EDICAO_MAXIMA,
  fonteDaVerdade,
  interpretarCorrecao,
  lerEdicaoManual,
  montarPromptDeCorrecao,
  PEDIDO_MAXIMO,
  problemaNoPedido,
  textoDoCurriculo,
} from '../src/curriculo/corrigir.ts';

const CV = `Maria Souza
maria@exemplo.com · Belo Horizonte
Analista de Marketing — Loja Azul (2021–2024)
Aumentei a conversão de e-mail em 30% em 2023.
Formação: Publicidade, UFMG, 2016–2020.
Ferramentas: Google Analytics, RD Station, Excel.`;

const ATUAL: CurriculoAdaptado = {
  nome: 'Maria Souza',
  titulo: 'Analista de Marketing focada em CRM',
  contato: ['maria@exemplo.com'],
  resumo: 'Experiência em CRM e e-mail.',
  experiencias: [
    { cargo: 'Analista de Marketing', empresa: 'Loja Azul', periodo: '2021–2024', itens: ['Aumentei a conversão de e-mail em 30%.'] },
  ],
  formacao: [{ curso: 'Publicidade', instituicao: 'UFMG', periodo: '2016–2020' }],
  habilidades: ['RD Station', 'Google Analytics'],
  idiomas: [],
  certificacoes: [],
  mudancas: ['Destaquei CRM, que a vaga pede.'],
  lacunas: ['Espanhol', 'SQL'],
};

const VAGA = { cargo: 'Analista de CRM', empresa: 'Banco X' };

describe('problemaNoPedido', () => {
  it('recusa vazio e longo demais, aceita o normal', () => {
    assert.ok(problemaNoPedido('  '));
    assert.ok(problemaNoPedido('a'.repeat(PEDIDO_MAXIMO + 1)));
    assert.equal(problemaNoPedido('Tire o resumo.'), null);
  });
});

describe('montarPromptDeCorrecao', () => {
  it('leva CV original, versão atual e pedido, sem a descrição da vaga nem as mudanças', () => {
    const p = montarPromptDeCorrecao(CV, ATUAL, VAGA, [], 'Tire o resumo.');
    assert.match(p, /<curriculo_original>\nMaria Souza/);
    assert.match(p, /"titulo":"Analista de Marketing focada em CRM"/);
    assert.match(p, /<pedido>\nTire o resumo\.\n<\/pedido>/);
    assert.match(p, /Cargo: Analista de CRM/);
    assert.doesNotMatch(p, /Destaquei CRM/);
    assert.doesNotMatch(p, /trocas_anteriores/);
  });

  it('inclui só as últimas trocas', () => {
    const historico = Array.from({ length: 9 }, (_, i) => ({ pedido: `pedido ${i}`, resposta: `resposta ${i}` }));
    const p = montarPromptDeCorrecao(CV, ATUAL, VAGA, historico, 'mais um');
    assert.doesNotMatch(p, /pedido 2\b/);
    assert.match(p, /Pessoa: pedido 3\nVocê: resposta 3/);
    assert.match(p, /Pessoa: pedido 8/);
  });
});

describe('interpretarCorrecao', () => {
  it('lê o CV novo, mantém as mudanças da adaptação e troca as lacunas quando vêm', () => {
    const novo = { ...ATUAL, resumo: '', mudancas: ['inventada'], lacunas: ['SQL'] };
    const r = interpretarCorrecao(JSON.stringify({ resposta: 'Tirei o resumo.', curriculo: novo }), ATUAL);
    assert.equal(r.resposta, 'Tirei o resumo.');
    assert.equal(r.curriculo?.resumo, '');
    assert.deepEqual(r.curriculo?.mudancas, ATUAL.mudancas);
    assert.deepEqual(r.curriculo?.lacunas, ['SQL']);
  });

  it('sem a lista de lacunas, fica a anterior', () => {
    const { lacunas: _l, ...semLacunas } = ATUAL;
    const r = interpretarCorrecao(JSON.stringify({ resposta: 'ok', curriculo: semLacunas }), ATUAL);
    assert.deepEqual(r.curriculo?.lacunas, ATUAL.lacunas);
  });

  it('currículo null é recusa: só a resposta', () => {
    const r = interpretarCorrecao('{"resposta": "Não posso inventar um número.", "curriculo": null}', ATUAL);
    assert.equal(r.curriculo, null);
    assert.match(r.resposta, /inventar/);
  });

  it('recusa sem resposta, JSON quebrado e currículo vazio', () => {
    assert.throws(() => interpretarCorrecao('{"resposta": "", "curriculo": null}', ATUAL), RespostaInvalida);
    assert.throws(() => interpretarCorrecao('{"resposta": "ok", "curri', ATUAL), RespostaInvalida);
    assert.throws(
      () => interpretarCorrecao(JSON.stringify({ resposta: 'ok', curriculo: { nome: 'Maria' } }), ATUAL),
      RespostaInvalida,
    );
  });

  it('aceita o JSON embrulhado em cerca de código', () => {
    const r = interpretarCorrecao('```json\n{"resposta": "Nada a mudar.", "curriculo": null}\n```', ATUAL);
    assert.equal(r.resposta, 'Nada a mudar.');
  });
});

describe('fonteDaVerdade', () => {
  it('o que a pessoa afirmou no chat não vira alerta; o que a IA acrescentou, sim', () => {
    const comEspanhol: CurriculoAdaptado = {
      ...ATUAL,
      experiencias: [
        {
          ...ATUAL.experiencias[0]!,
          itens: ['Aumentei a conversão de e-mail em 30%.', 'Atendi clientes hispânicos em espanhol fluente diariamente.'],
        },
      ],
    };
    const pedido = 'Acrescenta que eu atendi clientes hispânicos em espanhol fluente diariamente.';
    assert.ok(verificarFidelidade(CV, comEspanhol).some((a) => a.tipo === 'acrescimo'));
    assert.deepEqual(verificarFidelidade(fonteDaVerdade(CV, [pedido]), comEspanhol), []);
  });
});

describe('lerEdicaoManual', () => {
  it('aceita a edição e preserva mudanças e lacunas', () => {
    const r = lerEdicaoManual({ ...ATUAL, resumo: 'Escrito por mim.', mudancas: ['x'], lacunas: [] }, ATUAL);
    assert.ok('curriculo' in r);
    assert.equal(r.curriculo.resumo, 'Escrito por mim.');
    assert.deepEqual(r.curriculo.mudancas, ATUAL.mudancas);
    assert.deepEqual(r.curriculo.lacunas, ATUAL.lacunas);
  });

  it('recusa sem nome, sem experiência nem formação, e lixo', () => {
    assert.match((lerEdicaoManual({ ...ATUAL, nome: ' ' }, ATUAL) as { erro: string }).erro, /nome/);
    assert.match(
      (lerEdicaoManual({ ...ATUAL, experiencias: [], formacao: [] }, ATUAL) as { erro: string }).erro,
      /experiência ou formação/,
    );
    assert.ok('erro' in lerEdicaoManual('texto', ATUAL));
    assert.ok('erro' in lerEdicaoManual({ ...ATUAL, resumo: 'x'.repeat(EDICAO_MAXIMA) }, ATUAL));
  });

  it('o que a pessoa escreveu à mão não vira alerta', () => {
    const editado = {
      ...ATUAL,
      experiencias: [{ ...ATUAL.experiencias[0]!, itens: ['Coordenei campanhas sazonais de fidelização com parceiros varejistas.'] }],
    };
    assert.ok(verificarFidelidade(CV, editado).length > 0);
    assert.deepEqual(verificarFidelidade(fonteDaVerdade(CV, [textoDoCurriculo(editado)]), editado), []);
  });
});
