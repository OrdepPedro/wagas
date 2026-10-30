import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Provedor } from '../src/classificar/llm.ts';
import { CurriculoSemTexto } from '../src/curriculo/medir.ts';
import {
  estruturarCurriculo,
  interpretarEstrutura,
  MAX_HABILIDADES_GUPY,
  montarPromptDePlataforma,
  pendenciasDe,
  quebrarTopicos,
} from '../src/curriculo/plataformas.ts';
import { RespostaInvalida } from '../src/curriculo/prompt.ts';
import type { Extracao } from '../src/curriculo/tipos.ts';

const extracao: Extracao = {
  texto: 'Analista de Dados na Acme, 2022–2025. SQL, Power BI.',
  sinais: {
    tipo: 'texto',
    paginas: null,
    caracteres: 52,
    semTexto: false,
    colunas: false,
    tabelas: 0,
    caixasDeTexto: 0,
    imagens: 0,
    contatoSoNoCabecalho: false,
  },
};

const experiencia = {
  cargo: 'Analista de Dados',
  empresa: 'Acme',
  periodo: '2022 – 2025',
  descricao: 'Área de vendas.\n• Automatizei relatórios em Power BI, reduzindo [X horas] por semana.',
  competencias: ['SQL', 'Power BI', 'sql', 'Python', 'Excel', 'ETL', 'Looker'],
};

const opcoes = { modelo: 'teste', comVaga: false };

describe('interpretarEstrutura', () => {
  it('LinkedIn: corta headline extra, dedup sem caixa e teto de competência por experiência', () => {
    const r = interpretarEstrutura(
      JSON.stringify({
        headlines: ['A | B', 'C | D', 'E | F'],
        sobre: 'Analista com [N anos] de experiência.',
        experiencias: [experiencia],
        competencias: ['SQL', 'SQL', 'Power BI'],
        destaques: ['Dashboard público'],
      }),
      'linkedin',
      opcoes,
    );
    assert.equal(r.plataforma, 'linkedin');
    if (r.plataforma !== 'linkedin') return;
    assert.deepEqual(r.headlines, ['A | B', 'C | D']);
    assert.deepEqual(r.competencias, ['SQL', 'Power BI']);
    assert.deepEqual(r.experiencias[0]?.competencias, ['SQL', 'Power BI', 'Python', 'Excel', 'ETL']);
    assert.deepEqual(r.pendencias, ['[N anos]', '[X horas]']);
  });

  it('Gupy: sem competência por experiência, habilidades até o teto da plataforma', () => {
    const habilidades = Array.from({ length: 40 }, (_, i) => `Habilidade ${i}`);
    const r = interpretarEstrutura(
      JSON.stringify({ experiencias: [experiencia], habilidades, apresenteSe: 'Sou analista de dados.' }),
      'gupy',
      { modelo: 'teste', comVaga: true },
    );
    assert.equal(r.plataforma, 'gupy');
    if (r.plataforma !== 'gupy') return;
    assert.equal(r.habilidades.length, MAX_HABILIDADES_GUPY);
    assert.deepEqual(r.experiencias[0]?.competencias, []);
    assert.equal(r.apresenteSeGenerico, false);
  });

  it('texto principal faltando é erro, não resultado incompleto', () => {
    assert.throws(
      () => interpretarEstrutura(JSON.stringify({ experiencias: [], habilidades: [] }), 'gupy', opcoes),
      RespostaInvalida,
    );
    assert.throws(
      () => interpretarEstrutura(JSON.stringify({ headlines: [], sobre: 'x' }), 'linkedin', opcoes),
      RespostaInvalida,
    );
    assert.throws(() => interpretarEstrutura('não é json', 'gupy', opcoes), RespostaInvalida);
  });

  it('experiência sem descrição é descartada; sem experiência nenhuma, segue (estágio)', () => {
    const r = interpretarEstrutura(
      JSON.stringify({ experiencias: [{ cargo: 'X', empresa: 'Y', periodo: '', descricao: '' }], habilidades: [], apresenteSe: 'Oi.' }),
      'gupy',
      opcoes,
    );
    assert.deepEqual(r.experiencias, []);
  });
});

describe('quebrarTopicos', () => {
  it('põe cada tópico na própria linha, sem linha em branco no começo nem duplicar quebra', () => {
    assert.equal(quebrarTopicos('Contexto. • Fiz A. • Fiz B.'), 'Contexto.\n• Fiz A.\n• Fiz B.');
    assert.equal(quebrarTopicos('• Fiz A.\n• Fiz B.'), '• Fiz A.\n• Fiz B.');
    assert.equal(quebrarTopicos('Sem tópicos.'), 'Sem tópicos.');
  });
});

describe('pendenciasDe', () => {
  it('acha marcadores sem repetir e ignora colchete vazio ou com quebra de linha', () => {
    assert.deepEqual(pendenciasDe(['[X%] e [X%]', '[]', '[a\nb]', '[de A para B]']), ['[X%]', '[de A para B]']);
  });
});

describe('montarPromptDePlataforma', () => {
  it('Gupy proíbe data na descrição; sem vaga, o "Apresente-se" é para o cargo', () => {
    const p = montarPromptDePlataforma({ extracao, plataforma: 'gupy', cargo: 'Analista de Dados', vaga: null });
    assert.match(p, /NUNCA ponha datas/);
    assert.match(p, /escreva para o cargo-alvo "Analista de Dados"/);
    assert.doesNotMatch(p, /\nVAGA\n/);
  });

  it('LinkedIn pede duas headlines e leva a vaga quando houver', () => {
    const p = montarPromptDePlataforma({ extracao, plataforma: 'linkedin', cargo: 'Analista de Dados', vaga: 'Vaga X' });
    assert.match(p, /exatamente 2 opções/);
    assert.match(p, /\nVAGA\nVaga X\n/);
  });
});

describe('estruturarCurriculo', () => {
  it('recusa arquivo sem texto antes de gastar chamada', async () => {
    let chamadas = 0;
    const provedor: Provedor = {
      nome: 'teste',
      async julgar() {
        chamadas++;
        return '{}';
      },
    };
    await assert.rejects(
      estruturarCurriculo(
        { extracao: { ...extracao, sinais: { ...extracao.sinais, semTexto: true } }, plataforma: 'gupy', cargo: 'X', vaga: null },
        provedor,
      ),
      CurriculoSemTexto,
    );
    assert.equal(chamadas, 0);
  });

  it('vaga só com espaço conta como sem vaga', async () => {
    const provedor: Provedor = {
      nome: 'teste',
      async julgar(prompt) {
        assert.doesNotMatch(prompt, /\nVAGA\n/);
        return JSON.stringify({ experiencias: [], habilidades: ['SQL'], apresenteSe: 'Oi.' });
      },
    };
    const r = await estruturarCurriculo({ extracao, plataforma: 'gupy', cargo: 'X', vaga: '   ' }, provedor);
    assert.equal(r.plataforma === 'gupy' && r.apresenteSeGenerico, true);
  });
});
