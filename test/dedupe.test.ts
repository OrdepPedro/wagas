import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chaveDedupVaga,
  dedupPorHash,
  normalizarCargo,
  normalizarEmpresa,
  separarNovos,
} from '../src/dedupe.ts';
import { normalizarItem } from '../src/normalize/resultado.ts';
import { canonicalizarUrl, hashUrl } from '../src/normalize/url.ts';
import type { PseItem } from '../src/pse/tipos.ts';
import type { Combinacao } from '../src/tipos.ts';

function comHash(urlHash: string, marca: string) {
  return { urlHash, marca };
}

function combo(id: string, fonte: Combinacao['fonte']): Combinacao {
  return {
    id,
    cargo: 'Product Manager',
    modelo: 'remoto',
    localizacao: null,
    fonte,
    dork: 'dork de teste',
    dateRestrict: fonte === 'linkedin_post' ? 'd7' : null,
    paginas: 1,
    ativo: true,
  };
}

describe('dedupPorHash', () => {
  it('mantém a primeira ocorrência e separa as repetidas', () => {
    const { unicos, duplicados } = dedupPorHash([
      comHash('a', '1o'),
      comHash('b', '2o'),
      comHash('a', 'repetido'),
      comHash('c', '3o'),
      comHash('b', 'repetido'),
    ]);

    assert.deepEqual(
      unicos.map((u) => u.marca),
      ['1o', '2o', '3o'],
    );
    assert.deepEqual(
      duplicados.map((d) => d.marca),
      ['repetido', 'repetido'],
    );
  });

  it('preserva a ordem — a primeira ocorrência é a de melhor posição na SERP', () => {
    const entrada = ['x', 'y', 'z'].map((h, i) => comHash(h, String(i)));
    assert.deepEqual(
      dedupPorHash(entrada).unicos.map((u) => u.marca),
      ['0', '1', '2'],
    );
  });

  it('aceita lista vazia', () => {
    assert.deepEqual(dedupPorHash([]), { unicos: [], duplicados: [] });
  });

  it('não mexe em hashes distintos', () => {
    const entrada = [comHash('a', '1'), comHash('b', '2')];
    assert.equal(dedupPorHash(entrada).unicos.length, 2);
    assert.equal(dedupPorHash(entrada).duplicados.length, 0);
  });
});

describe('dedup de ponta a ponta — o caso que motiva a feature', () => {
  it('a mesma vaga do LinkedIn vinda de dois combos vira uma linha só', () => {
    const doComboBh: PseItem = {
      title: 'Acme hiring Product Manager | LinkedIn',
      link: 'https://br.linkedin.com/jobs/view/product-manager-at-acme-4012345678?refId=aaa',
    };
    const doComboRemoto: PseItem = {
      title: 'Acme hiring Product Manager | LinkedIn',
      link: 'https://www.linkedin.com/jobs/view/4012345678?trk=public_jobs&position=7',
    };

    const coletados = [
      normalizarItem(doComboBh, { combo: combo('pm-bh-job', 'linkedin_job'), start: 1, indice: 0 })!,
      normalizarItem(doComboRemoto, {
        combo: combo('pm-remoto-job', 'linkedin_job'),
        start: 1,
        indice: 4,
      })!,
    ];

    const { unicos, duplicados } = dedupPorHash(coletados);
    assert.equal(unicos.length, 1);
    assert.equal(duplicados.length, 1);
    assert.equal(unicos[0]?.comboId, 'pm-bh-job', 'fica o primeiro, de melhor posição');
  });

  it('post e vaga de ATS continuam separados — só a dedup semântica os funde', () => {
    // ~50% do bloco de posts repete o bloco de ATS, mas com URL diferente.
    // A dedup por hash não resolve isso, e não deve fingir que resolve.
    const post = canonicalizarUrl(
      'https://www.linkedin.com/posts/recrutadora_vaga-activity-7212345678901234567-Ab',
    )!;
    const ats = canonicalizarUrl('https://acme.gupy.io/jobs/1234567')!;
    assert.notEqual(hashUrl(post.url), hashUrl(ats.url));
  });
});

describe('separarNovos', () => {
  it('divide entre inédito e já conhecido pelo banco', () => {
    const conhecidos = new Set(['b', 'c']);
    const { novos, jaConhecidos } = separarNovos(
      [comHash('a', '1'), comHash('b', '2'), comHash('d', '3'), comHash('c', '4')],
      conhecidos,
    );

    assert.deepEqual(
      novos.map((n) => n.marca),
      ['1', '3'],
    );
    assert.deepEqual(
      jaConhecidos.map((n) => n.marca),
      ['2', '4'],
    );
  });

  it('com banco vazio tudo é novo; com tudo conhecido nada é', () => {
    const itens = [comHash('a', '1'), comHash('b', '2')];
    assert.equal(separarNovos(itens, new Set()).novos.length, 2);
    assert.equal(separarNovos(itens, new Set(['a', 'b'])).novos.length, 0);
  });
});

describe('chave de dedup de vaga (empresa + cargo normalizado)', () => {
  it('ignora caixa, acento, pontuação e espaço', () => {
    assert.equal(
      chaveDedupVaga('Nubank', 'Product Manager Sênior'),
      chaveDedupVaga('  nubank ', 'PRODUCT   MANAGER, SENIOR'),
    );
  });

  it('ignora ruído societário que aparece em uma fonte e não na outra', () => {
    assert.equal(
      chaveDedupVaga('Grupo Boticário', 'Product Manager'),
      chaveDedupVaga('boticario', 'Product Manager'),
    );
    assert.equal(chaveDedupVaga('Acme Ltda', 'PM'), chaveDedupVaga('Acme', 'PM'));
  });

  it('preserva senioridade — júnior e sênior são vagas diferentes', () => {
    assert.notEqual(
      chaveDedupVaga('Acme', 'Product Manager Júnior'),
      chaveDedupVaga('Acme', 'Product Manager Sênior'),
    );
  });

  it('não funde empresas diferentes com o mesmo cargo', () => {
    assert.notEqual(chaveDedupVaga('Acme', 'Product Manager'), chaveDedupVaga('Omie', 'Product Manager'));
  });

  it('normalizadores isolados', () => {
    assert.equal(normalizarCargo('Analista de Dados Plêno'), 'analista de dados pleno');
    assert.equal(normalizarEmpresa('Açaí Tech S.A.'), 'acai tech');
  });
});
