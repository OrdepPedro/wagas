/**
 * Clientes do Supabase para o front-end.
 *
 * Diferença que importa em relação ao `src/db/supabase.ts` do coletor: aquele
 * usa a `sb_secret_...`, que IGNORA RLS, e por isso só existe em secret do
 * Actions e em `.env` local. Aqui a chave é a pública, e tudo que o usuário
 * enxerga é o que as policies da migration 0005 permitirem. Trocar uma pela
 * outra entregaria o acervo inteiro para qualquer visitante.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function ambiente(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) throw new Error(`variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

export const SUPABASE_URL = (): string => ambiente('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
export const SUPABASE_ANON = (): string => ambiente('NEXT_PUBLIC_SUPABASE_ANON_KEY');

/**
 * Cliente ligado aos cookies da requisição — é ele que sabe quem está logado.
 *
 * O `try/catch` do `setAll` não é preguiça: Server Components não podem
 * escrever cookie, e a renovação de sessão acontece no middleware. Deixar
 * estourar aqui derrubaria a página inteira por causa de um refresh de token
 * que o middleware já vai refazer.
 */
export async function clienteDoServidor() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL(), SUPABASE_ANON(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(paraGravar) {
        try {
          for (const { name, value, options } of paraGravar) cookieStore.set(name, value, options);
        } catch {
          // Server Component: quem grava é o middleware.
        }
      },
    },
  });
}

export interface Usuario {
  id: string;
  email: string | null;
  /**
   * Sessão anônima (Supabase `signInAnonymously`). Conta como visitante para o
   * teto diário. Se logins anônimos estiverem desligados no projeto, ninguém
   * chega aqui com `true` e o caminho simplesmente não é usado.
   */
  visitante: boolean;
}

/**
 * Quem está logado; sem sessão, cria a sessão anônima de visitante (trava 7).
 *
 * SÓ em Server Action: é o único lugar, junto com Route Handler, onde o Next
 * deixa gravar o cookie da sessão nova.
 *
 * A sessão nasce aqui, no momento em que a pessoa AGE (busca, sugere cargo,
 * mede currículo), e não no carregamento da página. Até 25/11 o `proxy.ts`
 * criava a sessão a cada GET em `/`: eram 939 contas anônimas para ~120
 * visitantes do Analytics, com rajadas de 124 contas em 10 minutos e 2
 * visitantes no dia — robô sem cookie com user-agent de navegador, que filtro
 * de user-agent não pega. Robô carrega página; não submete formulário.
 */
export async function usuarioOuVisitante(): Promise<Usuario | null> {
  const atual = await usuarioAtual();
  if (atual) return atual;
  const supabase = await clienteDoServidor();
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) return null;
  return { id: data.user.id, email: null, visitante: true };
}

/** Quem está logado, ou null. Usa `getUser`, que valida o token no servidor. */
export async function usuarioAtual(): Promise<Usuario | null> {
  const supabase = await clienteDoServidor();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    visitante: Boolean(data.user.is_anonymous),
  };
}
