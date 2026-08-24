import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMBINACOES,
  combosAtivos,
  expandirQueries,
  orcamentoDoCiclo,
  validarCombinacoes,
} from '../src/config/searches.ts';

const LIMITE_DIARIO = 100;
const RODADAS_POR_DIA = 3;

describe('combinações de busca', () => {
  it('começa com 15', () => {
    assert.equal(COMBINACOES.length, 15);
  });

  it('cabe na cota diária mesmo rodando 3x ao dia', () => {
    const porDia = orcamentoDoCiclo() * RODADAS_POR_DIA;
    assert.ok(
      porDia <= LIMITE_DIARIO,
      `${orcamentoDoCiclo()} queries x ${RODADAS_POR_DIA} rodadas = ${porDia} > ${LIMITE_DIARIO}`,
    );
  });

  it('cobre mais de um segmento — validar só com PM/BH é amostra enviesada', () => {
    const cargos = new Set(combosAtivos().map((c) => c.cargo));
    assert.ok(cargos.size >= 4, `só ${cargos.size} cargos distintos`);
    const locais = new Set(combosAtivos().map((c) => c.localizacao ?? 'remoto'));
    assert.ok(locais.size >= 3, `só ${locais.size} localizações distintas`);
  });

  it('cobre as três fontes validadas no Passo 1', () => {
    const fontes = new Set(COMBINACOES.map((c) => c.fonte));
    assert.deepEqual([...fontes].sort(), ['ats_gupy', 'linkedin_job', 'linkedin_post']);
  });

  it('todo combo de post tem dateRestrict — ranking de post segue engajamento, não data', () => {
    for (const c of COMBINACOES.filter((x) => x.fonte === 'linkedin_post')) {
      assert.ok(c.dateRestrict, `combo ${c.id} sem dateRestrict`);
    }
  });

  it('nenhum combo de vaga formal gasta cota com filtro de data (é redundante)', () => {
    for (const c of COMBINACOES.filter((x) => x.fonte === 'linkedin_job')) {
      assert.equal(c.dateRestrict, null, `combo ${c.id} não precisa de dateRestrict`);
    }
  });

  it('os dorks usam correspondência exata de frase e restrição de site', () => {
    for (const c of COMBINACOES) {
      assert.match(c.dork, /^site:/, `combo ${c.id} sem site:`);
      assert.match(c.dork, /"/, `combo ${c.id} sem aspas`);
    }
  });

  it('validarCombinacoes rejeita id duplicado e post sem dateRestrict', () => {
    const base = COMBINACOES[0]!;
    assert.throws(() => validarCombinacoes([base, base]), /duplicado/);
    assert.throws(
      () => validarCombinacoes([{ ...base, fonte: 'linkedin_post', dateRestrict: null }]),
      /dateRestrict/,
    );
    assert.throws(() => validarCombinacoes([{ ...base, paginas: 0 }]), /paginas/);
  });
});

describe('expandirQueries', () => {
  it('gera uma query por página, com start de 10 em 10', () => {
    const queries = expandirQueries([
      { ...COMBINACOES[0]!, id: 'x', paginas: 3 },
      { ...COMBINACOES[0]!, id: 'y', paginas: 1 },
    ]);
    assert.deepEqual(
      queries.map((q) => [q.combo.id, q.pagina, q.start]),
      [
        ['x', 1, 1],
        ['x', 2, 11],
        ['x', 3, 21],
        ['y', 1, 1],
      ],
    );
  });

  it('ignora combo inativo', () => {
    const queries = expandirQueries([{ ...COMBINACOES[0]!, ativo: false }]);
    assert.equal(queries.length, 0);
  });

  it('o total bate com o orçamento anunciado', () => {
    assert.equal(expandirQueries().length, orcamentoDoCiclo());
  });
});
