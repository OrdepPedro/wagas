/**
 * Lista de cargos cobertos pela coleta diária, para a landing.
 *
 * Lê `cargos_sugeridos` pela RLS (0014), que só entrega o que a coleta já
 * achou vaga. Falha — inclusive migration não aplicada — devolve só a
 * pré-carga: a seção continua de pé.
 */
import { CARGOS_PRE_CARGA } from '../../src/config/pre-carga.ts';
import { juntarCargos } from '../../src/cargos/abrangidos.ts';
import { clienteDoServidor } from './supabase.ts';

export async function carregarCargosAbrangidos(): Promise<string[]> {
  try {
    const supabase = await clienteDoServidor();
    const { data, error } = await supabase
      .from('cargos_sugeridos')
      .select('cargo')
      .order('criado_em', { ascending: true })
      .limit(500);
    if (error) throw error;
    return juntarCargos(CARGOS_PRE_CARGA, (data ?? []).map((l) => l.cargo as string));
  } catch {
    return [...CARGOS_PRE_CARGA];
  }
}
