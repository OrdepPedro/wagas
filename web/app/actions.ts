'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { clienteDoServidor, usuarioAtual } from '../lib/supabase.ts';
import { salvarPerfil } from '../lib/perfil.ts';
import { chaveDaBusca, gravarBuscaDaSessao } from '../lib/sessao.ts';

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

  const cargo = String(form.get('cargo') ?? '');
  const cidade = String(form.get('cidade') ?? '');
  const soRemoto = form.get('soRemoto') === 'on';

  const falha = await salvarPerfil(usuario.id, cargo, cidade, soRemoto);
  if (falha) return { erro: falha.mensagem };

  // Server Action é um dos dois lugares onde o Next deixa gravar cookie. É aqui
  // que a sessão aprende que esta busca foi pedida — e, se já tinha sido, que
  // esta submissão é uma repetição.
  await gravarBuscaDaSessao(chaveDaBusca(cargo, cidade, soRemoto));

  revalidatePath('/');
  redirect('/');
}

/** Atalho das buscas salvas do visitante: mesma ação, sem estado de formulário. */
export async function voltarParaBusca(form: FormData): Promise<void> {
  await definirBusca({}, form);
}

export async function sair(): Promise<void> {
  const supabase = await clienteDoServidor();
  await supabase.auth.signOut();
  redirect('/');
}
