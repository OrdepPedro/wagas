import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALVOS,
  alvosAtivos,
  custoDoCiclo,
  expandirAlvo,
  expandirTodos,
  JANELA,
  montarDork,
  validarAlvos,
  type Alvo,
} from '../src/config/alvos.ts';

const ALVO: Alvo = { id: 'teste', cargo: 'Product Manager', cidade: 'Belo Horizonte', ativo: true };

describe('montarDork', () => {
  it('vaga formal: cargo entre aspas + cidade entre aspas', () => {
    assert.equal(
      montarDork('linkedin_job', 'Product Manager', 'cidade', 'Belo Horizonte'),
      'site:linkedin.com/jobs/view "Product Manager" "Belo Horizonte"',
    );
  });

  it('vaga formal remota: cidade sai, entram os termos de remoto', () => {
    assert.equal(
      montarDork('linkedin_job', 'Product Manager', 'remoto', 'Belo Horizonte'),
      'site:linkedin.com/jobs/view "Product Manager" ("remoto" OR "home office" OR "100% remoto")',
    );
  });

  it('post sempre com intitle: — é o pré-filtro por título, feito na origem', () => {
    for (const recorte of ['cidade', 'remoto'] as const) {
      const dork = montarDork('linkedin_post', 'Product Manager', recorte, 'São Paulo');
      assert.match(dork, /intitle:"product manager"/, `sem intitle: no recorte ${recorte}`);
    }
  });

  it('post usa o cargo em minúsculas e carrega os negativos medidos', () => {
    const dork = montarDork('linkedin_post', 'Analista de Dados', 'remoto', 'São Paulo');
    assert.match(dork, /intitle:"analista de dados"/);
    assert.match(dork, /-curso -mentoria -programa$/);
    assert.ok(!dork.includes('-bootcamp'), 'negativo não medido no Passo 1');
  });

  it('gupy remoto usa termo simples — o composto derruba o recall dessa fonte', () => {
    assert.equal(
      montarDork('ats_gupy', 'Enfermeiro', 'remoto', 'São Paulo'),
      'site:gupy.io "Enfermeiro" "remoto"',
    );
    assert.equal(
      montarDork('ats_gupy', 'Enfermeiro', 'cidade', 'São Paulo'),
      'site:gupy.io "Enfermeiro" "São Paulo"',
    );
  });

  it('inhire segue o molde da gupy', () => {
    assert.equal(
      montarDork('ats_inhire', 'Enfermeiro', 'remoto', 'São Paulo'),
      'site:inhire.app "Enfermeiro" "remoto"',
    );
    assert.equal(
      montarDork('ats_inhire', 'Enfermeiro', 'cidade', 'São Paulo'),
      'site:inhire.app "Enfermeiro" "São Paulo"',
    );
  });

  it('todo dork tem site: e correspondência exata de frase', () => {
    for (const bloco of ['linkedin_job', 'linkedin_post', 'ats_gupy', 'ats_inhire'] as const) {
      for (const recorte of ['cidade', 'remoto'] as const) {
        const dork = montarDork(bloco, 'Product Designer', recorte, 'Curitiba');
        assert.match(dork, /^site:/, `${bloco}/${recorte} sem site:`);
        assert.match(dork, /"/, `${bloco}/${recorte} sem aspas`);
      }
    }
  });
});

describe('expansão', () => {
  it('um alvo vira 4 blocos x 2 recortes x páginas', () => {
    assert.equal(expandirAlvo(ALVO, 1).length, 8);
    assert.equal(expandirAlvo(ALVO, 3).length, 24);
  });

  it('cobre os dois recortes em cada bloco', () => {
    const consultas = expandirAlvo(ALVO, 1);
    for (const bloco of ['linkedin_job', 'linkedin_post', 'ats_gupy', 'ats_inhire']) {
      const doBloco = consultas.filter((c) => c.bloco === bloco);
      assert.equal(doBloco.length, 2, `${bloco} deveria ter cidade e remoto`);
      assert.deepEqual(
        doBloco.map((c) => c.recorte).sort(),
        ['cidade', 'remoto'],
      );
    }
  });

  it('pagina de 1 até N, sem pular', () => {
    const doJob = expandirAlvo(ALVO, 3).filter(
      (c) => c.bloco === 'linkedin_job' && c.recorte === 'cidade',
    );
    assert.deepEqual(
      doJob.map((c) => c.pagina),
      [1, 2, 3],
    );
  });

  it('ignora alvo inativo', () => {
    assert.equal(expandirTodos(1, [{ ...ALVO, ativo: false }]).length, 0);
  });

  it('custoDoCiclo bate com o número real de consultas', () => {
    for (const paginas of [1, 2, 3]) {
      assert.equal(expandirTodos(paginas).length, custoDoCiclo(paginas));
    }
  });
});

describe('alvos configurados', () => {
  it('todos têm cargo e cidade, com ids únicos', () => {
    assert.doesNotThrow(() => validarAlvos());
    assert.ok(alvosAtivos().length > 0);
  });

  it('cobre mais de um cargo e sai do núcleo tech', () => {
    const cargos = new Set(alvosAtivos().map((a) => a.cargo));
    assert.ok(cargos.size >= 4, `só ${cargos.size} cargos distintos`);
    // Medido em 23/08: Auxiliar Administrativo teve mais posts que Front-end.
    assert.ok(
      alvosAtivos().some((a) => a.cargo === 'Auxiliar Administrativo'),
      'sem nenhum cargo fora de tech, a validação volta a ser enviesada',
    );
  });

  it('validarAlvos rejeita id duplicado e campo vazio', () => {
    assert.throws(() => validarAlvos([ALVO, ALVO]), /duplicado/);
    assert.throws(() => validarAlvos([{ ...ALVO, cidade: '  ' }]), /obrigatórios/);
  });

  it('a janela é de 7 dias — a promessa do produto', () => {
    assert.equal(JANELA, 'qdr:w');
  });

  it('o ciclo completo cabe nos créditos gratuitos', () => {
    const porRodada = custoDoCiclo(3, ALVOS);
    assert.ok(porRodada <= 2500, `${porRodada} créditos por rodada estoura o saldo gratuito`);
  });
});
