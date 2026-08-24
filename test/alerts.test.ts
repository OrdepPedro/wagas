import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parsearFeed } from '../src/alerts/feed.ts';
import { normalizarEntrada, normalizarFeed } from '../src/alerts/normalizar.ts';
import { desembrulharLinkDoGoogle } from '../src/alerts/url.ts';
import { ALERTAS } from '../src/config/alertas.ts';
import { COMBINACOES } from '../src/config/searches.ts';
import { dedupPorHash } from '../src/dedupe.ts';
import { hashUrl } from '../src/normalize/url.ts';

const ALERTA = ALERTAS[0]!;

describe('desembrulharLinkDoGoogle', () => {
  it('extrai o destino do redirect do Alerts', () => {
    const bruta =
      'https://www.google.com/url?rct=j&sa=t&url=https://br.linkedin.com/jobs/view/pm-at-acme-4012345678&ct=ga&cd=abc&usg=xyz';
    assert.equal(
      desembrulharLinkDoGoogle(bruta),
      'https://br.linkedin.com/jobs/view/pm-at-acme-4012345678',
    );
  });

  it('aceita destino percent-encoded', () => {
    const bruta =
      'https://www.google.com/url?url=https%3A%2F%2Facme.gupy.io%2Fjobs%2F1234567&ct=ga';
    assert.equal(desembrulharLinkDoGoogle(bruta), 'https://acme.gupy.io/jobs/1234567');
  });

  it('funciona com domínio regional do Google', () => {
    assert.equal(
      desembrulharLinkDoGoogle('https://www.google.com.br/url?url=https://exemplo.com/vaga'),
      'https://exemplo.com/vaga',
    );
  });

  it('deixa passar link que já veio direto', () => {
    assert.equal(
      desembrulharLinkDoGoogle('https://acme.gupy.io/jobs/999'),
      'https://acme.gupy.io/jobs/999',
    );
  });

  it('recusa redirect sem destino aproveitável', () => {
    assert.equal(desembrulharLinkDoGoogle('https://www.google.com/url?ct=ga&cd=abc'), null);
    assert.equal(desembrulharLinkDoGoogle('https://www.google.com/url?url=javascript:alert(1)'), null);
    assert.equal(desembrulharLinkDoGoogle(''), null);
    assert.equal(desembrulharLinkDoGoogle('não é url'), null);
  });

  it('sem desembrulhar, tudo colapsaria num hash só — o bug que isso previne', () => {
    const a = 'https://www.google.com/url?url=https://br.linkedin.com/jobs/view/pm-4012345678&ct=ga';
    const b = 'https://www.google.com/url?url=https://br.linkedin.com/jobs/view/pm-4099999999&ct=ga';
    assert.notEqual(
      hashUrl(desembrulharLinkDoGoogle(a)!),
      hashUrl(desembrulharLinkDoGoogle(b)!),
      'vagas distintas não podem gerar o mesmo hash',
    );
  });
});

// ---------------------------------------------------------------------------

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Alerta do Google - Product Manager</title>
  <entry>
    <id>tag:google.com,2013:googlealerts/feed:111</id>
    <title type="html">Acme contrata &lt;b&gt;Product Manager&lt;/b&gt; em Belo Horizonte | LinkedIn</title>
    <link href="https://www.google.com/url?rct=j&amp;sa=t&amp;url=https://br.linkedin.com/jobs/view/product-manager-at-acme-4012345678&amp;ct=ga&amp;usg=abc"/>
    <published>2026-08-22T09:15:00Z</published>
    <updated>2026-08-22T09:15:00Z</updated>
    <content type="html">Vaga de &lt;b&gt;Product Manager&lt;/b&gt; presencial.</content>
  </entry>
  <entry>
    <id>tag:google.com,2013:googlealerts/feed:222</id>
    <title type="html">Product Manager - Acme</title>
    <link href="https://www.google.com/url?url=https://acme.gupy.io/jobs/7654321&amp;ct=ga"/>
    <published>2026-08-21T18:00:00Z</published>
    <content type="html">Publicada em 20/08/2026. Efetivo (CLT).</content>
  </entry>
</feed>`;

describe('parsearFeed', () => {
  it('lê as entradas e desembrulha os links', () => {
    const entradas = parsearFeed(FEED);
    assert.equal(entradas.length, 2);
    assert.equal(entradas[0]?.link, 'https://br.linkedin.com/jobs/view/product-manager-at-acme-4012345678');
    assert.equal(entradas[1]?.link, 'https://acme.gupy.io/jobs/7654321');
  });

  it('decodifica entidades do título e guarda a data de detecção', () => {
    const primeira = parsearFeed(FEED)[0]!;
    // O parser só decodifica; tirar o sufixo do portal é da normalização.
    assert.equal(primeira.titulo, 'Acme contrata Product Manager em Belo Horizonte | LinkedIn');
    assert.equal(primeira.publicadoEm, '2026-08-22T09:15:00.000Z');
    assert.equal(primeira.id, 'tag:google.com,2013:googlealerts/feed:111');
  });

  it('o sufixo do portal cai na normalização, não no parser', () => {
    const r = normalizarEntrada(parsearFeed(FEED)[0]!, ALERTA, 1)!;
    assert.equal(r.titulo, 'Acme contrata Product Manager em Belo Horizonte');
  });

  it('feed vazio ou lixo não quebra', () => {
    assert.deepEqual(parsearFeed('<feed></feed>'), []);
    assert.deepEqual(parsearFeed(''), []);
    assert.deepEqual(parsearFeed('<html><body>erro 404</body></html>'), []);
  });

  it('pula entrada sem link', () => {
    const semLink = '<feed><entry><id>x</id><title>Sem link</title></entry></feed>';
    assert.deepEqual(parsearFeed(semLink), []);
  });
});

// ---------------------------------------------------------------------------

describe('normalizarEntrada', () => {
  it('produz a mesma linha de raw_results que a PSE produzia', () => {
    const entradas = parsearFeed(FEED);
    const r = normalizarEntrada(entradas[0]!, ALERTA, 1)!;

    assert.equal(r.urlCanonica, 'https://www.linkedin.com/jobs/view/4012345678');
    assert.equal(r.urlHash, hashUrl('https://www.linkedin.com/jobs/view/4012345678'));
    assert.equal(r.fonte, 'linkedin_job');
    assert.equal(r.fonteId, '4012345678');
    assert.equal(r.comboId, ALERTA.id);
    assert.equal(r.cargoBusca, 'Product Manager');
    assert.equal(r.dataIndexacao, '2026-08-22T09:15:00.000Z');
  });

  it('ainda lê a data explícita da Gupy do resumo', () => {
    const entradas = parsearFeed(FEED);
    const r = normalizarEntrada(entradas[1]!, ALERTA, 2)!;
    assert.equal(r.fonte, 'ats_gupy');
    assert.equal(r.dataPublicacaoOrigem, 'gupy_snippet');
    assert.equal(r.dataPublicacao, new Date('2026-08-20T00:00:00-03:00').toISOString());
  });

  it('a dedup entre alertas continua funcionando na fonte nova', () => {
    const { normalizados } = normalizarFeed(parsearFeed(FEED), ALERTA);
    const outroAlerta = { ...ALERTA, id: 'pm-remoto-job' };
    const doOutro = normalizarFeed(parsearFeed(FEED), outroAlerta).normalizados;

    const { unicos, duplicados } = dedupPorHash([...normalizados, ...doOutro]);
    assert.equal(unicos.length, 2);
    assert.equal(duplicados.length, 2);
    assert.equal(unicos[0]?.comboId, ALERTA.id);
  });
});

describe('config de alertas', () => {
  it('as consultas herdam os dorks validados no Passo 1', () => {
    for (const a of ALERTAS) {
      assert.match(a.consulta, /^site:/, `alerta ${a.id} sem site:`);
      assert.match(a.consulta, /"/, `alerta ${a.id} sem aspas`);
    }
  });

  it('ids batem com os combos da PSE — a comparação com o Passo 1 depende disso', () => {
    const ids = ALERTAS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, 'id duplicado');
    assert.ok(ids.includes('pm-bh-job'));
    assert.ok(ids.includes('pm-remoto-post-titulo'));
  });

  /**
   * Alerts e Serper precisam rodar a MESMA consulta, senão a comparação entre
   * as duas fontes mede dork diferente e não fonte diferente. Já divergiu uma
   * vez (o alerta de post ficou sem `intitle:`); este teste impede a repetição.
   * Se mudar um dork aqui, tem que editar o alerta em google.com/alerts também.
   */
  it('cada alerta usa exatamente o dork do combo de mesmo id', () => {
    for (const alerta of ALERTAS) {
      const combo = COMBINACOES.find((c) => c.id === alerta.id);
      assert.ok(combo, `nenhum combo com id ${alerta.id}`);
      assert.equal(
        alerta.consulta,
        combo.dork,
        `divergência em ${alerta.id}:\n  alerta:  ${alerta.consulta}\n  combo:   ${combo.dork}`,
      );
    }
  });
});
