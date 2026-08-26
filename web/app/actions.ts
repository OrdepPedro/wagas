'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { clienteDoServidor, usuarioAtual } from '../lib/supabase.ts';
import { salvarPerfil } from '../lib/perfil.ts';

export interface EstadoDoFormulario {
  erro?: string;
  aviso?: string;
  enviadoPara?: string;
}

/**
 * Login por link mágico.
 *
 * Sem senha de propósito: senha exige tela de recuperação, política de força e
 * um campo a mais para o usuário errar, e nada disso é o que o Passo 4 quer
 * medir. O que ele quer medir é se a pessoa volta no dia 7.
 *
 * O remetente padrão do Supabase tem limite baixo de e-mails por hora. Serve
 * para o teste de um usuário; o Passo 5, com dez pessoas, vai precisar de SMTP
 * próprio.
 */
export async function entrar(
  _anterior: EstadoDoFormulario,
  form: FormData,
): Promise<EstadoDoFormulario> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { erro: 'Esse e-mail não parece válido.' };
  }

  const cabecalhos = await headers();
  const origem =
    process.env['NEXT_PUBLIC_SITE_URL']?.trim() ||
    `https://${cabecalhos.get('host') ?? 'localhost:3000'}`.replace(
      'https://localhost',
      'http://localhost',
    );

  const supabase = await clienteDoServidor();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origem}/auth/callback` },
  });

  if (error) return { erro: 'Não consegui enviar o link. Tente de novo em alguns minutos.' };
  return { enviadoPara: email };
}

export async function definirBusca(
  _anterior: EstadoDoFormulario,
  form: FormData,
): Promise<EstadoDoFormulario> {
  const usuario = await usuarioAtual();
  if (!usuario) return { erro: 'Sua sessão expirou. Entre de novo.' };

  const falha = await salvarPerfil(
    usuario.id,
    String(form.get('cargo') ?? ''),
    String(form.get('cidade') ?? ''),
  );
  if (falha) return { erro: falha.mensagem };

  revalidatePath('/');
  redirect('/');
}

export async function sair(): Promise<void> {
  const supabase = await clienteDoServidor();
  await supabase.auth.signOut();
  redirect('/');
}
