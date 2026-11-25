'use server';

import { revalidatePath } from 'next/cache';
import { desligarAlertas, ligarAlertas } from '../../lib/alertas.ts';
import { usuarioAtual } from '../../lib/supabase.ts';

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
  await ligarAlertas(usuario.id);
  revalidatePath('/vagas');
  revalidatePath('/mapa');
}

export async function desligarEmailSemanal(): Promise<void> {
  const usuario = await usuarioAtual();
  if (!usuario) return;
  await desligarAlertas(usuario.id);
  revalidatePath('/vagas');
  revalidatePath('/mapa');
}
