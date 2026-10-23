import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Renova a sessão a cada navegação.
 *
 * Chama-se `proxy` e não `middleware` porque o Next 16 renomeou a convenção;
 * o arquivo `middleware.ts` ainda funciona, mas avisa que vai sair.
 *
 * Server Components não podem gravar cookie, então o refresh do token precisa
 * acontecer aqui — sem isso a sessão morre na expiração do access token e o
 * usuário é jogado para a tela de login no meio do uso, que é exatamente o
 * comportamento que estragaria a medição de retenção no dia 7.
 *
 * `getUser()` é chamado de propósito, e não `getSession()`: é a chamada que
 * valida o token contra o servidor e dispara a renovação.
 */
export default async function proxy(requisicao: NextRequest) {
  let resposta = NextResponse.next({ request: requisicao });

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const chave = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !chave) return resposta;

  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll() {
        return requisicao.cookies.getAll();
      },
      setAll(paraGravar) {
        for (const { name, value } of paraGravar) requisicao.cookies.set(name, value);
        resposta = NextResponse.next({ request: requisicao });
        for (const { name, value, options } of paraGravar) {
          resposta.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();

  // Visitante sem sessão ganha uma sessão anônima, invisível (trava 7). É ela
  // que dá ao teto diário um `user_id` para contar. Aqui e não na página porque
  // Server Component não grava cookie (achado 31).
  //
  // Só em navegação de documento para `/`: prefetch, `/ir/...` e o callback do
  // link mágico não podem criar usuário — cada um viraria uma conta anônima a
  // mais por visita, e o callback trocaria a sessão que está chegando.
  if (!data.user && deveCriarVisitante(requisicao)) {
    await supabase.auth.signInAnonymously();
  }

  return resposta;
}

function deveCriarVisitante(requisicao: NextRequest): boolean {
  if (requisicao.method !== 'GET') return false;
  if (requisicao.nextUrl.pathname !== '/') return false;
  const h = requisicao.headers;
  if (h.get('next-router-prefetch') || h.get('purpose') === 'prefetch') return false;
  if (h.get('sec-purpose')?.includes('prefetch')) return false;
  // Robô de busca e pré-visualização de link não são visitantes.
  if (/bot|crawl|spider|preview|facebookexternalhit|whatsapp/i.test(h.get('user-agent') ?? '')) {
    return false;
  }
  return true;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
