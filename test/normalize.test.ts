import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dataDoSnippetGupy, extrairDataIndexacao, extrairDataPublicacao, paraIso } from '../src/normalize/datas.ts';
import { normalizarItem, normalizarLote, paraLinha } from '../src/normalize/resultado.ts';
import { decodificarEntidades, limparSnippet, limparTexto, limparTitulo } from '../src/normalize/texto.ts';
import { canonicalizarUrl, hashUrl } from '../src/normalize/url.ts';
import type { PseItem } from '../src/pse/tipos.ts';
import type { Combinacao } from '../src/tipos.ts';

const COMBO: Combinacao = {
  id: 'pm-bh-job',
  cargo: 'Product Manager',
  modelo: 'qualquer',
  localizacao: 'Belo Horizonte',
  fonte: 'linkedin_job',
  dork: 'site:linkedin.com/jobs/view "Product Manager" "Belo Horizonte"',
  dateRestrict: null,
  paginas: 2,
  ativo: true,
};

// ---------------------------------------------------------------------------

describe('canonicalizarUrl — LinkedIn (vaga)', () => {
  it('reduz slug, subdomínio de país e tracking ao id da vaga', () => {
    const c = canonicalizarUrl(
      'https://br.linkedin.com/jobs/view/product-manager-at-acme-4012345678?refId=abc&trackingId=xyz&position=3',
    );
    assert.deepEqual(c, {
      url: 'https://www.linkedin.com/jobs/view/4012345678',
      fonte: 'linkedin_job',
      fonteId: '4012345678',
    });
  });

  it('dá o mesmo hash para as variantes da mesma vaga', () => {
    const variantes = [
      'https://br.linkedin.com/jobs/view/product-manager-at-acme-4012345678?refId=abc',
      'https://www.linkedin.com/jobs/view/4012345678',
      'http://linkedin.com/jobs/view/product-manager-4012345678/?trk=public_jobs',
      'https://br.linkedin.com/jobs/view/gerente-de-produto-na-acme-4012345678?position=1&pageNum=0',
    ];
    const hashes = new Set(variantes.map((u) => hashUrl(canonicalizarUrl(u)!.url)));
    assert.equal(hashes.size, 1, 'as 4 variantes deveriam colapsar em um hash só');
  });

  it('aceita a vaga vinda por currentJobId', () => {
    const c = canonicalizarUrl('https://www.linkedin.com/jobs/view/?currentJobId=4055555555');
    assert.equal(c?.url, 'https://www.linkedin.com/jobs/view/4055555555');
    assert.equal(c?.fonteId, '4055555555');
  });

  it('não confunde vagas diferentes', () => {
    const a = canonicalizarUrl('https://br.linkedin.com/jobs/view/pm-at-acme-4012345678')!;
    const b = canonicalizarUrl('https://br.linkedin.com/jobs/view/pm-at-acme-4012345679')!;
    assert.notEqual(hashUrl(a.url), hashUrl(b.url));
  });
});

describe('canonicalizarUrl — LinkedIn (post)', () => {
  it('reduz o post ao urn da atividade', () => {
    const c = canonicalizarUrl(
      'https://www.linkedin.com/posts/maria-recrutadora_vaga-produto-activity-7212345678901234567-AbCd?utm_source=share',
    );
    assert.deepEqual(c, {
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7212345678901234567',
      fonte: 'linkedin_post',
      fonteId: '7212345678901234567',
    });
  });

  it('colapsa /posts/ e /feed/update/ na mesma URL', () => {
    const viaPost = canonicalizarUrl(
      'https://br.linkedin.com/posts/joao_contratando-activity-7212345678901234567-XyZ',
    )!;
    const viaFeed = canonicalizarUrl(
      'https://www.linkedin.com/feed/update/urn:li:activity:7212345678901234567/',
    )!;
    assert.equal(viaPost.url, viaFeed.url);
  });

  it('sobrevive a post sem id de atividade', () => {
    const c = canonicalizarUrl('https://www.linkedin.com/posts/empresa-x_vagas-abertas/');
    assert.equal(c?.fonte, 'linkedin_post');
    assert.equal(c?.fonteId, null);
    assert.equal(c?.url, 'https://www.linkedin.com/posts/empresa-x_vagas-abertas');
  });
});

describe('canonicalizarUrl — Gupy', () => {
  it('preserva o subdomínio (é a empresa) e descarta a query', () => {
    const c = canonicalizarUrl(
      'https://acme.gupy.io/jobs/1234567?jobBoardSource=gupy_public_page&utm_medium=cpc',
    );
    assert.deepEqual(c, {
      url: 'https://acme.gupy.io/jobs/1234567',
      fonte: 'ats_gupy',
      fonteId: '1234567',
    });
  });

  it('não funde empresas diferentes com o mesmo id de vaga', () => {
    const a = canonicalizarUrl('https://acme.gupy.io/jobs/1234567')!;
    const b = canonicalizarUrl('https://outra.gupy.io/jobs/1234567')!;
    assert.notEqual(a.url, b.url);
  });
});

describe('canonicalizarUrl — InHire', () => {
  it('reduz a vaga ao id, preservando o subdomínio da empresa', () => {
    const c = canonicalizarUrl(
      'https://acme.inhire.app/vagas/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0/product-manager?utm_source=linkedin',
    );
    assert.deepEqual(c, {
      url: 'https://acme.inhire.app/vagas/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0',
      fonte: 'ats_inhire',
      fonteId: '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0',
    });
  });

  it('página de carreira sem vaga fica na fonte, mas sem id', () => {
    const c = canonicalizarUrl('https://acme.inhire.app/vagas/');
    assert.equal(c?.fonte, 'ats_inhire');
    assert.equal(c?.fonteId, null);
  });
});

describe('canonicalizarUrl — genérico', () => {
  it('força https, tira www, fragmento, barra final e tracking, e ordena o resto', () => {
    const c = canonicalizarUrl('http://www.exemplo.com.br/vagas/?b=2&utm_source=x&a=1#topo');
    assert.equal(c?.url, 'https://exemplo.com.br/vagas?a=1&b=2');
    assert.equal(c?.fonte, 'desconhecida');
  });

  it('mantém a raiz como /', () => {
    assert.equal(canonicalizarUrl('https://exemplo.com.br/')?.url, 'https://exemplo.com.br/');
  });

  it('rejeita entrada inaproveitável', () => {
    for (const ruim of ['', '   ', 'não é url', 'javascript:alert(1)', 'mailto:a@b.com']) {
      assert.equal(canonicalizarUrl(ruim), null, `deveria rejeitar: ${ruim}`);
    }
  });
});

describe('hashUrl', () => {
  it('é sha256 hex, estável e sensível à entrada', () => {
    const h = hashUrl('https://www.linkedin.com/jobs/view/4012345678');
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, hashUrl('https://www.linkedin.com/jobs/view/4012345678'));
    assert.notEqual(h, hashUrl('https://www.linkedin.com/jobs/view/4012345679'));
  });
});

// ---------------------------------------------------------------------------

describe('limpeza de texto', () => {
  it('decodifica entidades numéricas e nomeadas', () => {
    assert.equal(decodificarEntidades('Vaga &amp; Cia &#39;PM&#39; &quot;top&quot;'), `Vaga & Cia 'PM' "top"`);
  });

  it('desfaz a dupla codificação do Google — caso real do feed', () => {
    // "Supply Chain & Product Manager" chega assim no feed do Alerts.
    assert.equal(
      limparTitulo('Supply Chain &amp;amp; Product Manager na Acme | LinkedIn'),
      'Supply Chain & Product Manager na Acme',
    );
    assert.equal(limparTexto('Vaga P&amp;D'), 'Vaga P&D');
  });

  it('entidade decodificada primeiro, tag removida depois', () => {
    // O feed escapa o destaque como &lt;b&gt;: sem decodificar antes, a remoção
    // de tags não acha nada e o "<b>" vaza para o título do usuário.
    assert.equal(limparTexto('&lt;b&gt;Product Manager&lt;/b&gt; na Acme'), 'Product Manager na Acme');
  });

  it('remove o sufixo do portal e colapsa espaço', () => {
    assert.equal(
      limparTitulo('Acme   hiring  Product Manager in Belo Horizonte | LinkedIn'),
      'Acme hiring Product Manager in Belo Horizonte',
    );
    assert.equal(limparTitulo('Product Designer - Gupy'), 'Product Designer');
  });

  it('remove tags e nbsp do snippet', () => {
    assert.equal(limparSnippet('<b>Product</b> Manager\n  remoto'), 'Product Manager remoto');
  });

  it('aceita ausência de texto', () => {
    assert.equal(limparTitulo(undefined), '');
    assert.equal(limparSnippet(null), '');
  });
});

// ---------------------------------------------------------------------------

describe('datas', () => {
  it('lê "Publicada em DD/MM/AAAA" do snippet da Gupy como meia-noite de Brasília', () => {
    const iso = dataDoSnippetGupy('Product Manager. Publicada em 12/08/2026. Efetivo.');
    assert.equal(iso, new Date('2026-08-12T00:00:00-03:00').toISOString());
  });

  it('aceita "Publicado em" e dia/mês com um dígito', () => {
    assert.equal(
      dataDoSnippetGupy('Publicado em 3/9/2026'),
      new Date('2026-09-03T00:00:00-03:00').toISOString(),
    );
  });

  it('ignora data impossível ou ausente', () => {
    assert.equal(dataDoSnippetGupy('Publicada em 45/13/2026'), null);
    assert.equal(dataDoSnippetGupy('Vaga sem data'), null);
  });

  it('paraIso descarta lixo e ano absurdo', () => {
    assert.equal(paraIso('2026-08-12T10:00:00Z'), '2026-08-12T10:00:00.000Z');
    assert.equal(paraIso('ontem'), null);
    assert.equal(paraIso('1999-01-01T00:00:00Z'), null);
    assert.equal(paraIso(undefined), null);
  });

  it('prefere o snippet da Gupy à metatag quando a fonte é Gupy', () => {
    const item: PseItem = {
      pagemap: { metatags: [{ 'article:published_time': '2026-01-01T00:00:00Z' }] },
    };
    const { data, origem } = extrairDataPublicacao(item, 'ats_gupy', 'Publicada em 12/08/2026');
    assert.equal(origem, 'gupy_snippet');
    assert.equal(data, new Date('2026-08-12T00:00:00-03:00').toISOString());
  });

  it('cai na metatag quando não há snippet datado', () => {
    const item: PseItem = {
      pagemap: { metatags: [{ 'article:published_time': '2026-08-10T09:00:00Z' }] },
    };
    const { data, origem } = extrairDataPublicacao(item, 'linkedin_job', 'sem data aqui');
    assert.equal(origem, 'metatag');
    assert.equal(data, '2026-08-10T09:00:00.000Z');
  });

  it('usa jobposting.dateposted quando existe', () => {
    const item: PseItem = { pagemap: { jobposting: [{ dateposted: '2026-08-15' }] } };
    const { data, origem } = extrairDataPublicacao(item, 'linkedin_job', '');
    assert.equal(origem, 'metatag');
    assert.equal(data, '2026-08-15T00:00:00.000Z');
  });

  it('admite não saber a data — post costuma não dar nenhuma', () => {
    const { data, origem } = extrairDataPublicacao({}, 'linkedin_post', 'estamos contratando!');
    assert.equal(data, null);
    assert.equal(origem, 'desconhecida');
  });

  it('data de indexação vem da última modificação declarada, ou null', () => {
    const item: PseItem = { pagemap: { metatags: [{ 'og:updated_time': '2026-08-20T12:00:00Z' }] } };
    assert.equal(extrairDataIndexacao(item), '2026-08-20T12:00:00.000Z');
    assert.equal(extrairDataIndexacao({}), null);
  });
});

// ---------------------------------------------------------------------------

describe('normalizarItem', () => {
  const item: PseItem = {
    title: 'Acme hiring Product Manager in Belo Horizonte | LinkedIn',
    link: 'https://br.linkedin.com/jobs/view/product-manager-at-acme-4012345678?refId=abc',
    snippet: 'Vaga de <b>Product Manager</b>&nbsp;em Belo Horizonte.',
    pagemap: { metatags: [{ 'article:published_time': '2026-08-19T08:00:00Z' }] },
  };

  it('monta a linha completa a partir do item e do contexto de busca', () => {
    const r = normalizarItem(item, { combo: COMBO, start: 11, indice: 2 })!;
    assert.equal(r.urlCanonica, 'https://www.linkedin.com/jobs/view/4012345678');
    assert.equal(r.urlHash, hashUrl('https://www.linkedin.com/jobs/view/4012345678'));
    assert.equal(r.urlOriginal, item.link);
    assert.equal(r.titulo, 'Acme hiring Product Manager in Belo Horizonte');
    assert.equal(r.snippet, 'Vaga de Product Manager em Belo Horizonte.');
    assert.equal(r.fonte, 'linkedin_job');
    assert.equal(r.fonteId, '4012345678');
    assert.equal(r.comboId, 'pm-bh-job');
    assert.equal(r.cargoBusca, 'Product Manager');
    assert.equal(r.modeloBusca, 'qualquer');
    assert.equal(r.localizacaoBusca, 'Belo Horizonte');
    assert.equal(r.dataPublicacao, '2026-08-19T08:00:00.000Z');
    assert.equal(r.dataPublicacaoOrigem, 'metatag');
    assert.equal(r.posicaoSerp, 13, 'start 11 + índice 2');
    assert.deepEqual(r.payload, item);
  });

  it('classifica a fonte pela URL, não pelo combo que originou a busca', () => {
    const foraDoEsperado: PseItem = {
      title: 'Acme | LinkedIn',
      link: 'https://br.linkedin.com/company/acme',
    };
    const r = normalizarItem(foraDoEsperado, { combo: COMBO, start: 1, indice: 0 })!;
    assert.equal(r.fonte, 'desconhecida');
  });

  it('descarta item sem link, com link quebrado ou sem título', () => {
    const ctx = { combo: COMBO, start: 1, indice: 0 };
    assert.equal(normalizarItem({ title: 'Vaga' }, ctx), null);
    assert.equal(normalizarItem({ title: 'Vaga', link: 'ftp://x/y' }, ctx), null);
    assert.equal(normalizarItem({ link: 'https://exemplo.com/a', title: '   ' }, ctx), null);
  });

  it('normalizarLote conta descartes e numera a SERP em sequência', () => {
    const { normalizados, descartados } = normalizarLote(
      [item, { title: 'sem link' }, { title: 'Outra', link: 'https://acme.gupy.io/jobs/999' }],
      { combo: COMBO, start: 1 },
    );
    assert.equal(normalizados.length, 2);
    assert.equal(descartados, 1);
    assert.deepEqual(
      normalizados.map((n) => n.posicaoSerp),
      [1, 3],
    );
  });

  it('paraLinha usa exatamente os nomes de coluna de raw_results', () => {
    const linha = paraLinha(normalizarItem(item, { combo: COMBO, start: 1, indice: 0 })!);
    assert.deepEqual(Object.keys(linha).sort(), [
      'cargo_busca',
      'combo_id',
      'data_indexacao',
      'data_publicacao',
      'data_publicacao_origem',
      'fonte',
      'fonte_id',
      'localizacao_busca',
      'modelo_busca',
      'payload',
      'posicao_serp',
      'snippet',
      'titulo',
      'url_canonica',
      'url_hash',
      'url_original',
    ]);
  });
});
