import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canonicalizarUrl } from '../src/normalize/url.ts';
import { ehRedirectGoogle, resolverRedirectGoogle } from '../src/serper/redirect.ts';

const GOTO = 'https://www.google.com/goto?url=CAESmAEB6zswFUM219JbTr';
const DESTINO = 'https://br.linkedin.com/jobs/view/product-owner-at-bairesdev-4483883302';

function responde(status: number, location?: string): typeof fetch {
  return (async () =>
    new Response(null, { status, headers: location ? { location } : {} })) as typeof fetch;
}

describe('redirect google.com/goto da Serper', () => {
  it('reconhece o redirect e não confunde com outra URL do Google', () => {
    assert.equal(ehRedirectGoogle(GOTO), true);
    assert.equal(ehRedirectGoogle('https://google.com/goto?url=x'), true);
    assert.equal(ehRedirectGoogle('https://www.google.com/search?q=goto'), false);
    assert.equal(ehRedirectGoogle(DESTINO), false);
    assert.equal(ehRedirectGoogle('não é url'), false);
  });

  it('devolve o Location do 302 sem seguir', async () => {
    let redirect: RequestInit['redirect'];
    const impl = (async (_u: string | URL | Request, init?: RequestInit) => {
      redirect = init?.redirect;
      return new Response(null, { status: 302, headers: { location: DESTINO } });
    }) as typeof fetch;
    assert.equal(await resolverRedirectGoogle(GOTO, impl), DESTINO);
    assert.equal(redirect, 'manual');
  });

  // Sem isso o link resolvido virava `desconhecida` do mesmo jeito.
  it('o destino resolvido canonicaliza como vaga do LinkedIn', async () => {
    const destino = await resolverRedirectGoogle(GOTO, responde(302, DESTINO));
    const canonica = canonicalizarUrl(destino!);
    assert.equal(canonica?.fonte, 'linkedin_job');
    assert.equal(canonica?.fonteId, '4483883302');
  });

  it('falha vira null, nunca destino inventado', async () => {
    assert.equal(await resolverRedirectGoogle(GOTO, responde(200)), null);
    assert.equal(await resolverRedirectGoogle(GOTO, responde(302)), null);
    assert.equal(await resolverRedirectGoogle(GOTO, responde(302, '/sorry/index')), null);
    assert.equal(await resolverRedirectGoogle(GOTO, responde(302, GOTO)), null);
    const caiu = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    assert.equal(await resolverRedirectGoogle(GOTO, caiu), null);
  });
});
