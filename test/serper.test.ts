import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMBINACOES } from '../src/config/searches.ts';
import { dedupPorHash } from '../src/dedupe.ts';
import { hashUrl } from '../src/normalize/url.ts';
import {
  SerperCliente,
  SerperCreditosError,
  SerperErroFatal,
  SerperErroTransitorio,
  type ResultadoOrganico,
} from '../src/serper/cliente.ts';
import { normalizarOrganico, normalizarPaginaSerper } from '../src/serper/normalizar.ts';

const COMBO = COMBINACOES[0]!;

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function cliente(
  respostas: Array<() => Response>,
  opts: { orcamento?: number; tentativas?: number } = {},
) {
  const chamadas: Array<{ corpo: unknown; headers: Record<string, string> }> = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const proxima = respostas[chamadas.length];
    chamadas.push({
      corpo: JSON.parse(String(init?.body ?? '{}')),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (!proxima) throw new Error('fetch chamado mais vezes que o esperado');
    return proxima();
  }) as unknown as typeof fetch;

  const c = new SerperCliente({
    key: 'chave-de-teste',
    orcamento: opts.orcamento ?? 5,
    tentativas: opts.tentativas ?? 3,
    intervaloMs: 0,
    backoffBaseMs: 100,
    fetchImpl: impl,
    sleepImpl: async () => {},
    randomImpl: () => 0.5,
  });
  return { c, chamadas };
}

describe('requisição', () => {
  it('manda o dork intacto, com viés Brasil e sem autocorreção', async () => {
    const { c, chamadas } = cliente([() => json({ organic: [] })]);
    await c.buscar('site:gupy.io "Product Manager"', { pagina: 2 });

    assert.deepEqual(chamadas[0]?.corpo, {
      q: 'site:gupy.io "Product Manager"',
      gl: 'br',
      hl: 'pt-br',
      num: 10,
      page: 2,
      autocorrect: false,
    });
    assert.equal(chamadas[0]?.headers['X-API-KEY'], 'chave-de-teste');
  });

  it('autocorrect desligado — correção reescreveria o dork e estragaria a comparação', async () => {
    const { c, chamadas } = cliente([() => json({ organic: [] })]);
    await c.buscar('site:linkedin.com/jobs/view "Product Manager"');
    assert.equal((chamadas[0]?.corpo as { autocorrect: boolean }).autocorrect, false);
  });
});

describe('créditos', () => {
  it('conta um crédito por chamada e respeita o orçamento', async () => {
    const { c, chamadas } = cliente([() => json({ organic: [] })], { orcamento: 1 });
    await c.buscar('q1');
    assert.equal(c.consumidos, 1);
    assert.equal(c.restante, 0);
    await assert.rejects(() => c.buscar('q2'), SerperCreditosError);
    assert.equal(chamadas.length, 1, 'não pode bater na API sem crédito');
  });

  it('402 vira erro de crédito, sem retry', async () => {
    const { c, chamadas } = cliente([
      () => json({ message: 'Not enough credits' }, 402),
      () => json({ organic: [] }),
    ]);
    await assert.rejects(() => c.buscar('q1'), SerperCreditosError);
    assert.equal(chamadas.length, 1);
  });

  it('401 (chave errada) é fatal e não repete', async () => {
    const { c, chamadas } = cliente([
      () => json({ message: 'Unauthorized' }, 401),
      () => json({ organic: [] }),
    ]);
    await assert.rejects(() => c.buscar('q1'), SerperErroFatal);
    assert.equal(chamadas.length, 1);
  });

  it('falha de rede não queima crédito', async () => {
    const { c } = cliente([
      () => {
        throw new TypeError('fetch failed');
      },
      () => json({ organic: [] }),
    ]);
    await c.buscar('q1');
    assert.equal(c.consumidos, 1);
  });

  it('repete em 503 e devolve o resultado bom', async () => {
    const { c, chamadas } = cliente([
      () => json({}, 503),
      () => json({ organic: [{ title: 'ok', link: 'https://exemplo.com/a' }], credits: 1 }),
    ]);
    const r = await c.buscar('q1');
    assert.equal(r.organicos.length, 1);
    assert.equal(r.creditosReportados, 1);
    assert.equal(chamadas.length, 2);
  });

  it('desiste após as tentativas configuradas', async () => {
    const { c } = cliente([() => json({}, 500), () => json({}, 500)], { tentativas: 2 });
    await assert.rejects(() => c.buscar('q1'), SerperErroTransitorio);
  });
});

describe('normalização', () => {
  const item: ResultadoOrganico = {
    title: 'Acme hiring Product Manager in Belo Horizonte | LinkedIn',
    link: 'https://br.linkedin.com/jobs/view/product-manager-at-acme-4012345678?refId=x',
    snippet: 'Vaga de Product Manager em Belo Horizonte.',
    position: 3,
  };

  it('gera a mesma linha que a PSE e os Alerts geravam', () => {
    const r = normalizarOrganico(item, { combo: COMBO, pagina: 1, indice: 2 })!;
    assert.equal(r.urlCanonica, 'https://www.linkedin.com/jobs/view/4012345678');
    assert.equal(r.urlHash, hashUrl('https://www.linkedin.com/jobs/view/4012345678'));
    assert.equal(r.fonte, 'linkedin_job');
    assert.equal(r.fonteId, '4012345678');
    assert.equal(r.titulo, 'Acme hiring Product Manager in Belo Horizonte');
    assert.equal(r.comboId, COMBO.id);
  });

  it('soma o offset da página na posição da SERP', () => {
    const r = normalizarOrganico(item, { combo: COMBO, pagina: 2, indice: 2 })!;
    assert.equal(r.posicaoSerp, 13, 'página 2 (offset 10) + position 3');
  });

  it('lê a data explícita da Gupy do snippet', () => {
    const gupy: ResultadoOrganico = {
      title: 'Product Manager - Acme',
      link: 'https://acme.gupy.io/jobs/1234567',
      snippet: 'Publicada em 15/08/2026. Efetivo.',
      position: 1,
    };
    const r = normalizarOrganico(gupy, { combo: COMBO, pagina: 1, indice: 0 })!;
    assert.equal(r.dataPublicacaoOrigem, 'gupy_snippet');
    assert.equal(r.dataPublicacao, new Date('2026-08-15T00:00:00-03:00').toISOString());
  });

  it('descarta item sem link, sem título ou com URL inaproveitável', () => {
    const ctx = { combo: COMBO, pagina: 1, indice: 0 };
    assert.equal(normalizarOrganico({ title: 'x' }, ctx), null);
    assert.equal(normalizarOrganico({ link: 'https://a.com/b', title: '  ' }, ctx), null);
    assert.equal(normalizarOrganico({ title: 'x', link: 'ftp://a/b' }, ctx), null);
  });

  it('normalizarPaginaSerper conta descartes', () => {
    const { normalizados, descartados } = normalizarPaginaSerper([item, { title: 'sem link' }], {
      combo: COMBO,
      pagina: 1,
    });
    assert.equal(normalizados.length, 1);
    assert.equal(descartados, 1);
  });

  it('a mesma vaga vinda da Serper e dos Alerts colapsa num hash só', () => {
    // É isso que permite trocar de fonte sem duplicar o feed.
    const daSerper = normalizarOrganico(item, { combo: COMBO, pagina: 1, indice: 0 })!;
    const doAlerta = {
      ...daSerper,
      urlOriginal: 'https://www.linkedin.com/jobs/view/4012345678',
      comboId: 'via-alerts',
    };
    const { unicos, duplicados } = dedupPorHash([daSerper, doAlerta]);
    assert.equal(unicos.length, 1);
    assert.equal(duplicados.length, 1);
  });
});
