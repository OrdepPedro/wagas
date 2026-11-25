'use server';

import { revalidatePath } from 'next/cache';
import { clienteDoServidor, usuarioAtual } from '../../lib/supabase.ts';

/**
 * Liga o e-mail semanal. É o consentimento (LGPD): a linha nasce com
 * `consentido_em`, e só existe porque a pessoa clicou.
 *
 * Grava pela chave PÚBLICA, com a sessão da pessoa: a policy da 0025 garante
 * que cada um só liga o próprio alerta e que sessão anônima não liga nenhum.
 */
export async function ligarEmailSemanal(): Promise<void> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return;
  const supabase = await clienteDoServidor();
  const { data } = await supabase.from('alertas_email').select('user_id').eq('user_id', usuario.id).maybeSingle();
  if (data) {
    await supabase
      .from('alertas_email')
      .update({ ativo: true, desativado_em: null, consentido_em: new Date().toISOString() })
      .eq('user_id', usuario.id);
  } else {
    await supabase.from('alertas_email').insert({ user_id: usuario.id });
  }
  revalidatePath('/vagas');
  revalidatePath('/mapa');
}

export async function desligarEmailSemanal(): Promise<void> {
  const usuario = await usuarioAtual();
  if (!usuario) return;
  const supabase = await clienteDoServidor();
  await supabase
    .from('alertas_email')
    .update({ ativo: false, desativado_em: new Date().toISOString() })
    .eq('user_id', usuario.id);
  revalidatePath('/vagas');
  revalidatePath('/mapa');
}
