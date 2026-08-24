/**
 * Testes do golden set e do relatório.
 *
 * O primeiro bloco valida o ARQUIVO, não o código: um rótulo escrito errado à
 * mão passaria despercebido e envenenaria toda a medição seguinte. Golden set
 * é dado versionado — e dado versionado precisa de guarda tanto quanto código.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  avaliarPrefiltro,
  falhas,
  medir,
  medirLocal,
  medirPor,
  type Avaliado,
  type CasoRotulado,
} from '../src/classificar/harness.ts';

const CAMINHO = 'harness/golden.jsonl';

const casos: CasoRotulado[] = readFileSync(CAMINHO, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as CasoRotulado);

const ROTULOS = new Set(['relevante', 'irrelevante', 'indeterminado']);
const ROTULOS_LOCAL = new Set(['sim', 'nao', 'indeterminado']);
const FONTES = new Set(['linkedin_job', 'linkedin_post', 'ats_gupy']);
const CLASSES = new Set([
  '',
  'vaga_da_familia',
  'vaga_adjacente',
  'pagina_de_listagem',
  'nao_e_vaga',
  'cargo_de_outra_familia',
]);

describe('golden set', () => {
  it('tem caso suficiente para a medição significar alguma coisa', () => {
    assert.ok(casos.length >= 100, `só ${casos.length} casos`);
  });

  it('todo caso tem rótulo, fonte e classe do vocabulário fechado', () => {
    for (const c of casos) {
      assert.ok(ROTULOS.has(c.rotulo), `${c.id}: rótulo "${c.rotulo}"`);
      assert.ok(FONTES.has(c.fonte), `${c.id}: fonte "${c.fonte}"`);
      assert.ok(CLASSES.has(c.classe), `${c.id}: classe "${c.classe}"`);
      assert.ok(ROTULOS_LOCAL.has(c.rotuloLocal), `${c.id}: rotuloLocal "${c.rotuloLocal}"`);
      assert.notEqual(c.titulo.trim(), '', `${c.id}: sem título`);
      assert.notEqual(c.cargoBusca.trim(), '', `${c.id}: sem cargo buscado`);
    }
  });

  it('irrelevante sempre diz por quê; indeterminado nunca finge classe', () => {
    for (const c of casos) {
      if (c.rotulo === 'irrelevante') assert.notEqual(c.classe, '', `${c.id}`);
      if (c.rotulo === 'indeterminado') assert.equal(c.classe, '', `${c.id}`);
    }
  });

  it('ids não se repetem', () => {
    assert.equal(new Set(casos.map((c) => c.id)).size, casos.length);
  });

  it('cobre mais de um cargo e as três fontes', () => {
    // CLAUDE.md: validar só com Product Manager em Belo Horizonte é amostra
    // enviesada. Se o golden set voltar a ser só PM, o teste avisa.
    const cargos = new Set(casos.map((c) => c.cargoBusca));
    assert.ok(cargos.size >= 5, `só ${cargos.size} cargos`);
    assert.equal(new Set(casos.map((c) => c.fonte)).size, 3);
  });

  it('todo rótulo de local decidido diz por quê', () => {
    // "sim" e "nao" são julgamento; sem a justificativa escrita não dá para
    // outra pessoa contestar o rótulo, e golden set que ninguém contesta apodrece.
    for (const c of casos) {
      if (c.rotuloLocal !== 'indeterminado') {
        assert.notEqual(c.notaLocal.trim(), '', `${c.id}`);
      }
    }
  });

  it('tem negativo suficiente para precisão não ser enfeite', () => {
    const irrelevantes = casos.filter((c) => c.rotulo === 'irrelevante').length;
    assert.ok(irrelevantes >= 15, `só ${irrelevantes} irrelevantes`);
  });
});

describe('portão de local', () => {
  const decidido = casos.filter((c) => c.rotuloLocal !== 'indeterminado');

  it('o eixo de local não contamina o eixo de cargo', () => {
    // Uma vaga do cargo certo em outra cidade continua `relevante` no eixo de
    // cargo. Se alguém colapsar os dois rótulos, este teste quebra — e a
    // métrica de cargo, que tem histórico, deixaria de ser comparável.
    const localRuim = casos.filter((c) => c.rotuloLocal === 'nao');
    assert.ok(localRuim.length > 0);
    assert.ok(localRuim.some((c) => c.rotulo === 'relevante'));
  });

  it('conta só o que o LLM julgou: o pré-filtro não olha local', () => {
    const doPrefiltro: Avaliado[] = decidido.map((caso) => ({
      caso,
      previsto: true,
      motivo: 'passou',
      detalhe: '',
      estagio: 'prefiltro',
    }));
    assert.equal(medirLocal(doPrefiltro).avaliaveis, 0);
  });

  it('separa fechar errado de deixar passar', () => {
    const bom = casos.find((c) => c.rotuloLocal === 'sim')!;
    const ruim = casos.find((c) => c.rotuloLocal === 'nao')!;

    const m = medirLocal([
      // portão fechou numa vaga de local bom: some com a vaga
      { caso: bom, previsto: false, motivo: 'local_nao_serve', detalhe: '', estagio: 'llm' },
      // portão deixou passar vaga de outra cidade: lixo visível no feed
      { caso: ruim, previsto: true, motivo: 'aprovado', detalhe: '', estagio: 'llm' },
    ]);

    assert.equal(m.avaliaveis, 2);
    assert.equal(m.fechouErrado, 1);
    assert.equal(m.deixouPassar, 1);
    assert.equal(m.acertos, 0);
  });

  it('avisa quando há negativos de menos para concluir alguma coisa', () => {
    // Hoje são 2. Enquanto for assim, "o portão não deixou passar nada" não é
    // evidência de que ele funciona — é evidência de que não foi testado.
    const m = medirLocal(
      decidido.map((caso) => ({ caso, previsto: true, motivo: 'aprovado', detalhe: '', estagio: 'llm' })),
    );
    assert.ok(m.negativosDisponiveis < 5, 'se passou de 5, atualize o aviso do relatório');
  });
});

describe('pré-filtro sobre o golden set', () => {
  const avaliados = avaliarPrefiltro(casos);
  const metricas = medir(avaliados);

  it('não perde vaga boa: o recall do pré-filtro é o teto do produto inteiro', () => {
    // Esta é a garantia que não pode regredir. Se este teste quebrar, alguma
    // regra nova passou a cortar vaga relevante — e o que o pré-filtro corta
    // não é visto por mais ninguém.
    assert.equal(metricas.recall, 1, `perdeu: ${falhas(avaliados).falsosNegativos.map((a) => a.caso.titulo).join(' | ')}`);
  });

  it('derruba toda página de listagem da Gupy', () => {
    const listagens = avaliados.filter((a) => a.caso.classe === 'pagina_de_listagem');
    assert.ok(listagens.length > 0);
    for (const a of listagens) {
      assert.equal(a.previsto, false, a.caso.titulo);
      assert.equal(a.motivo, 'pagina_de_listagem');
    }
  });

  it('a precisão do pré-filtro é pior no bloco de posts — é onde o LLM tem trabalho', () => {
    // Não é defeito: posts não são filtrados por título de propósito (achado 3).
    // O teste registra o formato do problema para a regressão ficar visível.
    const porFonte = medirPor(avaliados, (c) => c.fonte);
    const posts = porFonte.get('linkedin_post');
    const jobs = porFonte.get('linkedin_job');
    assert.ok(posts?.precisao !== null && jobs?.precisao != null);
    assert.ok(posts!.precisao! < jobs!.precisao!);
  });
});
