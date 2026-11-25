/**
 * Alertas por e-mail: a chave geral (`alertas_email`, migration 0025) e as
 * buscas extras que o Mapa configura (`alertas_email_buscas`, 0026).
 *
 * Tudo pela chave pública e pela RLS. O teto de 5 extras mora na policy de
 * insert; aqui ele só vira mensagem antes de a pessoa bater nele.
 */
import { slugCidade } from '../../src/normalize/local.ts';
import { CIDADE_SO_REMOTO } from './perfil.ts';
import { clienteDoServidor } from './supabase.ts';

export const MAX_BUSCAS_EXTRAS = 5;

export interface BuscaExtra {
  id: number;
  cargo: string;
  cidade: string;
  so_remoto: boolean;
}

export interface Alertas {
  /** null = a migration 0025 não respondeu; a tela some com a seção. */
  ativo: boolean | null;
  /** null = a 0026 não foi aplicada. */
  extras: BuscaExtra[] | null;
}

export async function lerAlertas(userId: string): Promise<Alertas> {
  const supabase = await clienteDoServidor();
  const [chave, extras] = await Promise.all([
    supabase.from('alertas_email').select('ativo').eq('user_id', userId).maybeSingle(),
    supabase.from('alertas_email_buscas').select('id,cargo,cidade,so_remoto').eq('user_id', userId).order('id'),
  ]);
  return {
    ativo: chave.error ? null : Boolean(chave.data?.ativo),
    extras: extras.error ? null : (extras.data as BuscaExtra[]),
  };
}

/** Liga (ou religa) a chave geral. O clique é o consentimento: a data é renovada. */
export async function ligarAlertas(userId: string): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase.from('alertas_email').select('user_id').eq('user_id', userId).maybeSingle();
  const { error } = data
    ? await supabase
        .from('alertas_email')
        .update({ ativo: true, desativado_em: null, consentido_em: new Date().toISOString() })
        .eq('user_id', userId)
    : await supabase.from('alertas_email').insert({ user_id: userId });
  return !error;
}

export async function desligarAlertas(userId: string): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error } = await supabase
    .from('alertas_email')
    .update({ ativo: false, desativado_em: new Date().toISOString() })
    .eq('user_id', userId);
  return !error;
}

export type ResultadoDaBusca = 'ok' | 'invalida' | 'repetida' | 'limite' | 'falha';

/**
 * Mesma normalização de `salvarPerfil`: o slug sai da MESMA função que gravou
 * `jobs.cidade_slug`, senão o e-mail desta busca viria vazio sem causa aparente.
 */
export async function adicionarBusca(
  userId: string,
  cargoBruto: string,
  cidadeBruta: string,
  soRemoto: boolean,
): Promise<ResultadoDaBusca> {
  const cargo = cargoBruto.trim().replace(/\s+/g, ' ');
  let cidade = cidadeBruta.trim().replace(/\s+/g, ' ');
  if (soRemoto && cidade === '') cidade = CIDADE_SO_REMOTO;
  if (cargo.length < 2 || cargo.length > 80 || cidade.length < 2 || cidade.length > 80) return 'invalida';
  const cidadeSlug = slugCidade(cidade);
  if (cidadeSlug === '') return 'invalida';

  const supabase = await clienteDoServidor();
  const { count } = await supabase
    .from('alertas_email_buscas')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if ((count ?? 0) >= MAX_BUSCAS_EXTRAS) return 'limite';

  const { error } = await supabase
    .from('alertas_email_buscas')
    .insert({ user_id: userId, cargo, cidade, cidade_slug: cidadeSlug, so_remoto: soRemoto });
  if (error?.code === '23505') return 'repetida';
  // 42501: a policy recusou (teto batido entre a contagem e o insert).
  if (error?.code === '42501') return 'limite';
  if (error) return 'falha';
  // Acrescentar uma busca é pedir para recebê-la: liga a chave geral se estava desligada.
  return (await ligarAlertas(userId)) ? 'ok' : 'falha';
}

export async function removerBusca(userId: string, id: number): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error } = await supabase.from('alertas_email_buscas').delete().eq('id', id).eq('user_id', userId);
  return !error;
}
