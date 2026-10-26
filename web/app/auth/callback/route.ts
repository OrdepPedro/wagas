import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { clienteDoServidor } from '../../../lib/supabase.ts';

/**
 * Volta do link mágico.
 *
 * Duas formas de retorno, e o Supabase usa uma ou outra dependendo de como o
 * template de e-mail do projeto está configurado:
 *
 *   ?code=…                    fluxo PKCE
 *   ?token_hash=…&type=magiclink   link verificado no servidor
 *
 * Tratar as duas evita a falha mais chata possível neste ponto: o usuário clica
 * no e-mail, cai numa tela de erro, e não há nada que ele possa fazer.
 */
export async function GET(requisicao: Request) {
  const url = new URL(requisicao.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const tipo = url.searchParams.get('type') as EmailOtpType | null;

  const supabase = await clienteDoServidor();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/vagas', url.origin));
  } else if (tokenHash && tipo) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
    if (!error) return NextResponse.redirect(new URL('/vagas', url.origin));
  }

  return NextResponse.redirect(new URL('/?erro=link', url.origin));
}
