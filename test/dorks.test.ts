import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { montarDork } from '../src/config/alvos.ts';
import { gerarDorks } from '../src/dorks/gerador.ts';

describe('gerarDorks', () => {
  it('LinkedIn usa o dork validado, sem termo acrescentado', () => {
    const d = gerarDorks({ cargo: 'Product Manager', sites: ['linkedin_job'], periodo: 'semana', cidade: 'São Paulo' })[0]!;
    assert.equal(d.consulta, montarDork('linkedin_job', 'Product Manager', 'cidade', 'São Paulo'));
    const r = gerarDorks({ cargo: 'Product Manager', sites: ['linkedin_post'], periodo: 'semana', remoto: true })[0]!;
    assert.equal(r.consulta, montarDork('linkedin_post', 'Product Manager', 'remoto', ''));
  });

  it('sem local, não sobra aspas vazias', () => {
    for (const d of gerarDorks({ cargo: 'Enfermeiro', sites: ['linkedin_job', 'linkedin_post', 'gupy'], periodo: 'dia' })) {
      assert.ok(!d.consulta.includes('""'), d.consulta);
    }
  });

  it('remoto ignora a cidade, como no feed', () => {
    const d = gerarDorks({ cargo: 'Vendedor', sites: ['gupy'], periodo: 'semana', cidade: 'Belo Horizonte', remoto: true })[0]!;
    assert.ok(!d.consulta.includes('Belo Horizonte'));
    assert.ok(d.consulta.includes('"remoto"'));
  });

  it('período vira tbs no link; "qualquer" não manda tbs', () => {
    const d = gerarDorks({ cargo: 'Vendedor', sites: ['gupy'], periodo: 'dia' })[0]!;
    assert.equal(new URL(d.url).searchParams.get('tbs'), 'qdr:d');
    const q = gerarDorks({ cargo: 'Vendedor', sites: ['gupy'], periodo: 'qualquer' })[0]!;
    assert.equal(new URL(q.url).searchParams.get('tbs'), null);
  });

  it('aspas do usuário não quebram a frase exata', () => {
    const d = gerarDorks({ cargo: '"Analista" de Dados', sites: ['gupy'], periodo: 'semana' })[0]!;
    assert.equal(d.consulta, 'site:gupy.io "Analista de Dados"');
  });

  it('cargo vazio ou nenhum site devolve nada', () => {
    assert.deepEqual(gerarDorks({ cargo: '  ', sites: ['gupy'], periodo: 'semana' }), []);
    assert.deepEqual(gerarDorks({ cargo: 'Vendedor', sites: [], periodo: 'semana' }), []);
  });
});

describe('portais brasileiros', () => {
  it('cada portal gera dork próprio, com o cargo entre aspas', () => {
    const ids = ['vagas', 'catho', 'indeed', 'bne'];
    const dorks = gerarDorks({ cargo: 'Vendedor', sites: ids, periodo: 'semana', cidade: 'Recife' });
    assert.equal(dorks.length, ids.length);
    for (const d of dorks) assert.match(d.consulta, /^site:\S+ "Vendedor" "Recife"$/);
  });
});
