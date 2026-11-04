import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chaveDaDecisao,
  classificar,
  empresaDoSubdominio,
  resumir,
} from '../src/classificar/classificador.ts';
import { medir, avaliarDecisoes, type CasoRotulado } from '../src/classificar/harness.ts';
import { CadeiaDeProvedores, LlmIndisponivel, type Provedor } from '../src/classificar/llm.ts';
import { extrairJson, interpretarResposta, montarPrompt } from '../src/classificar/prompt.ts';
import { paraLinhaJob } from '../src/classificar/persistencia.ts';
import type { Candidato } from '../src/classificar/tipos.ts';

function candidato(parcial: Partial<Candidato> = {}): Candidato {
  return {
    id: 1,
    fonte: 'linkedin_job',
    fonteId: '4365109913',
    urlCanonica: 'https://www.linkedin.com/jobs/view/4365109913',
    titulo: 'Product Manager Sênior - SYDLE',
    snippet: '',
    cargoBusca: 'Product Manager',
    localizacaoBusca: 'Belo Horizonte',
    dataPublicacao: null,
    ...parcial,
  };
}

/** Provedor de mentira: devolve o que o teste mandar, sem rede. */
function provedorFalso(respostas: string[], nome = 'falso/teste'): Provedor & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    nome,
    prompts,
    async julgar(prompt: string) {
      prompts.push(prompt);
      const r = respostas[i] ?? respostas[respostas.length - 1];
      i++;
      if (r === undefined) throw new Error('sem resposta configurada');
      return r;
    },
  };
}

function julgamentos(...itens: Array<Record<string, unknown>>): string {
  return JSON.stringify({ julgamentos: itens });
}

describe('classificar', () => {
  it('não manda ao LLM o que o pré-filtro já derrubou', async () => {
    const provedor = provedorFalso([julgamentos({ id: 0, ehVaga: true, cargoBate: true, confianca: 0.9, motivo: 'ok', empresa: 'SYDLE' })]);

    const decisoes = await classificar(
      [candidato(), candidato({ id: 2, titulo: 'Especialista II SAP EWM' })],
      provedor,
    );

    assert.equal(decisoes[1]?.veredito, 'rejeitado');
    assert.equal(decisoes[1]?.estagio, 'prefiltro');
    assert.equal(provedor.prompts.length, 1);
    // Só o candidato aprovado no pré-filtro foi parar na lista de itens.
    // (O texto das instruções cita "SAP EWM" como exemplo de falso positivo,
    // então a busca precisa ser na lista, não no prompt inteiro.)
    const itens = provedor.prompts[0]?.slice(provedor.prompts[0].indexOf('ITENS:')) ?? '';
    assert.ok(itens.includes('SYDLE'));
    assert.ok(!itens.includes('SAP EWM'));
  });

  it('aprova, extrai e registra quem decidiu', async () => {
    const [decisao] = await classificar(
      [candidato()],
      provedorFalso([
        julgamentos({
          id: 0,
          ehVaga: true,
          cargoBate: true,
          empresa: 'SYDLE',
          cargo: 'Product Manager',
          senioridade: 'senior',
          modelo: 'hibrido',
          localizacao: 'Belo Horizonte',
          confianca: 0.92,
          motivo: 'vaga de PM explícita no título',
        }),
      ]),
    );

    assert.equal(decisao?.veredito, 'aprovado');
    assert.equal(decisao?.estagio, 'llm');
    assert.equal(decisao?.extracao?.empresa, 'SYDLE');
    assert.equal(decisao?.extracao?.senioridade, 'senior');
    assert.equal(decisao?.classificador, 'falso/teste');
  });

  it('separa "não é vaga" de "cargo de outra família"', async () => {
    const decisoes = await classificar(
      [candidato(), candidato({ id: 2 })],
      provedorFalso([
        julgamentos(
          { id: 0, ehVaga: false, cargoBate: false, confianca: 0.9, motivo: 'artigo sobre carreira' },
          { id: 1, ehVaga: true, cargoBate: false, confianca: 0.9, motivo: 'gestão de projetos' },
        ),
      ]),
    );

    assert.equal(decisoes[0]?.motivo, 'nao_e_vaga');
    assert.equal(decisoes[1]?.motivo, 'cargo_de_outra_familia');
  });

  it('reprova por confiança abaixo do mínimo', async () => {
    const [decisao] = await classificar(
      [candidato()],
      provedorFalso([julgamentos({ id: 0, ehVaga: true, cargoBate: true, confianca: 0.4, motivo: 'talvez' })]),
      { confiancaMinima: 0.6 },
    );

    assert.equal(decisao?.veredito, 'rejeitado');
    assert.equal(decisao?.motivo, 'confianca_baixa');
  });

  it('item sem julgamento vira erro, não chute', async () => {
    // O candidato precisa voltar na próxima rodada. Aprovar ou reprovar por
    // omissão gravaria uma decisão que ninguém tomou.
    const decisoes = await classificar(
      [candidato(), candidato({ id: 2 })],
      provedorFalso([julgamentos({ id: 0, ehVaga: true, cargoBate: true, confianca: 0.9, motivo: 'ok' })]),
    );

    assert.equal(decisoes[0]?.veredito, 'aprovado');
    assert.equal(decisoes[1]?.veredito, 'erro');
    assert.equal(decisoes[1]?.motivo, 'erro_do_classificador');
  });

  it('cota estourada para a rodada em vez de reprovar o resto', async () => {
    const provedor: Provedor = {
      nome: 'falso/sem-cota',
      julgar: async () => {
        throw new LlmIndisponivel('cota do dia', 429);
      },
    };

    const decisoes = await classificar([candidato(), candidato({ id: 2 })], provedor, {
      tamanhoDoLote: 1,
    });

    assert.deepEqual(
      decisoes.map((d) => d.veredito),
      ['erro', 'erro'],
    );
  });

  it('sem provedor, roda o pré-filtro e não aprova nada', async () => {
    const decisoes = await classificar(
      [candidato(), candidato({ id: 2, titulo: 'Especialista II SAP EWM' })],
      null,
    );

    assert.equal(decisoes[0]?.veredito, 'erro');
    assert.equal(decisoes[1]?.veredito, 'rejeitado');
    assert.equal(resumir(decisoes).aprovados, 0);
  });
});

describe('CadeiaDeProvedores', () => {
  it('cai para o próximo quando o primeiro está sem cota', async () => {
    const semCota: Provedor = {
      nome: 'gemini/x',
      julgar: async () => {
        throw new LlmIndisponivel('cota', 429);
      },
    };
    const reserva = provedorFalso(['{"julgamentos":[]}'], 'groq/y');

    const cadeia = new CadeiaDeProvedores([semCota, reserva]);
    assert.equal(await cadeia.julgar('p', null), '{"julgamentos":[]}');
    assert.equal(cadeia.nome, 'groq/y');
  });

  it('erro de formato NÃO desce para o próximo: gastaria a cota dele com o mesmo lote', async () => {
    const quebrado: Provedor = {
      nome: 'gemini/x',
      julgar: async () => {
        throw new Error('resposta sem texto');
      },
    };
    const reserva = provedorFalso(['{"julgamentos":[]}']);

    await assert.rejects(() => new CadeiaDeProvedores([quebrado, reserva]).julgar('p', null));
  });
});

describe('contrato de saída', () => {
  it('aceita JSON embrulhado em cerca de markdown', () => {
    const dados = extrairJson('```json\n{"julgamentos":[]}\n```');
    assert.deepEqual(dados, { julgamentos: [] });
  });

  it('descarta id fora do lote, id repetido e objeto incompleto', () => {
    const bruto = julgamentos(
      { id: 0, ehVaga: true, cargoBate: true, confianca: 0.9, motivo: 'ok' },
      { id: 0, ehVaga: false, cargoBate: false, confianca: 0.9, motivo: 'repetido' },
      { id: 9, ehVaga: true, cargoBate: true, confianca: 0.9, motivo: 'fora do lote' },
      { id: 1, ehVaga: 'sim', cargoBate: true, confianca: 0.9, motivo: 'tipo errado' },
    );

    const lidos = interpretarResposta(bruto, 2);
    assert.equal(lidos.length, 1);
    assert.equal(lidos[0]?.id, 0);
    assert.equal(lidos[0]?.motivo, 'ok');
  });

  it('prende a confiança entre 0 e 1', () => {
    const lidos = interpretarResposta(
      julgamentos({ id: 0, ehVaga: true, cargoBate: true, confianca: 7, motivo: 'ok' }),
      1,
    );
    assert.equal(lidos[0]?.confianca, 1);
  });

  it('só aceita senioridade e modelo do vocabulário fechado', () => {
    const lidos = interpretarResposta(
      julgamentos({
        id: 0,
        ehVaga: true,
        cargoBate: true,
        confianca: 0.9,
        motivo: 'ok',
        senioridade: 'mestre supremo',
        modelo: 'anywhere',
      }),
      1,
    );
    assert.equal(lidos[0]?.extracao.senioridade, null);
    assert.equal(lidos[0]?.extracao.modelo, null);
  });

  it('resposta em prosa não derruba a rodada', () => {
    assert.deepEqual(interpretarResposta('desculpe, não consigo', 3), []);
  });
});

describe('montarPrompt', () => {
  it('avisa que o snippet de vaga do LinkedIn é contaminado', () => {
    const prompt = montarPrompt([candidato()]);
    assert.ok(prompt.includes('vagas similares'));
    assert.ok(prompt.includes('empresa: null'));
  });

  it('numera os itens a partir de zero, para o id voltar casado', () => {
    const prompt = montarPrompt([candidato(), candidato({ id: 2, titulo: 'Outro' })]);
    assert.ok(prompt.includes('"id": 0'));
    assert.ok(prompt.includes('"id": 1'));
  });
});

describe('chave de dedup da vaga', () => {
  it('usa empresa + cargo quando há empresa', () => {
    const decisao = {
      candidato: candidato(),
      veredito: 'aprovado' as const,
      motivo: null,
      estagio: 'llm' as const,
      detalhe: '',
      confianca: 0.9,
      extracao: {
        empresa: 'SYDLE S.A.',
        cargo: 'Product Manager Sênior',
        senioridade: 'senior',
        modelo: null,
        localizacao: null,
      },
      classificador: 'falso/teste',
    };
    assert.equal(chaveDaDecisao(decisao), 'sydle|product manager senior');
  });

  it('sem empresa, cai para o id da fonte em vez de colapsar vagas diferentes', () => {
    const decisao = {
      candidato: candidato(),
      veredito: 'aprovado' as const,
      motivo: null,
      estagio: 'llm' as const,
      detalhe: '',
      confianca: 0.9,
      extracao: {
        empresa: null,
        cargo: 'Product Manager',
        senioridade: null,
        modelo: null,
        localizacao: null,
      },
      classificador: 'falso/teste',
    };
    assert.equal(chaveDaDecisao(decisao), 'sem-empresa:linkedin_job:4365109913|product manager');
    assert.equal(paraLinhaJob(decisao)['dedup_por_empresa'], false);
  });

  it('empresa da Gupy sai do subdomínio quando o modelo não achou nome', () => {
    assert.equal(empresaDoSubdominio('https://carreirasomie.gupy.io/jobs/12168950'), 'carreirasomie');
    assert.equal(empresaDoSubdominio('https://portal.gupy.io/job-search'), null);
    assert.equal(empresaDoSubdominio('https://www.linkedin.com/jobs/view/1'), null);
    assert.equal(empresaDoSubdominio('https://acme.inhire.app/vagas/0b1c2d3e'), 'acme');
  });
});

describe('métricas do harness', () => {
  const caso = (rotulo: CasoRotulado['rotulo'], id: string): CasoRotulado => ({
    id,
    origem: 'teste',
    cargoBusca: 'Product Manager',
    cidadeBusca: 'Belo Horizonte',
    recorte: 'cidade',
    fonte: 'linkedin_job',
    url: '',
    titulo: 'x',
    snippet: '',
    rotulo,
    classe: '',
    nota: '',
    rotuloLocal: 'indeterminado',
    notaLocal: '',
  });

  it('indeterminado fica fora da conta', () => {
    const casos = [caso('relevante', 'a'), caso('indeterminado', 'b')];
    const m = medir([
      { caso: casos[0]!, previsto: true, motivo: '', detalhe: '', estagio: 'llm' },
      { caso: casos[1]!, previsto: true, motivo: '', detalhe: '', estagio: 'llm' },
    ]);
    assert.equal(m.positivosVerdadeiros, 1);
    assert.equal(m.falsosPositivos, 0);
    assert.equal(m.precisao, 1);
  });

  it('erro de classificação não conta como reprovação', () => {
    // Senão uma cota estourada apareceria como recall despencando, e o número
    // acusaria o classificador de um problema que é de infraestrutura.
    const casos = [caso('relevante', 'a'), caso('relevante', 'b')];
    const m = medir(
      avaliarDecisoes(casos, [
        {
          candidato: candidato(),
          veredito: 'aprovado',
          motivo: null,
          estagio: 'llm',
          detalhe: '',
          confianca: 1,
          extracao: null,
          classificador: 't',
        },
        {
          candidato: candidato(),
          veredito: 'erro',
          motivo: 'erro_do_classificador',
          estagio: 'llm',
          detalhe: '',
          confianca: null,
          extracao: null,
          classificador: 't',
        },
      ]),
    );
    assert.equal(m.recall, 1);
    assert.equal(m.indefinidos, 1);
  });
});
