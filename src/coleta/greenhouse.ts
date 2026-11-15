/**
 * Coleta dos quadros do Greenhouse: baixa cada quadro, grava o que foi
 * publicado na janela e encerra o que a empresa tirou do ar.
 *
 * Encerrar aqui é mais seguro que na Gupy. A Gupy devolve uma busca, que pode
 * vir incompleta, e por isso a suspeita precisa de confirmação na página. O
 * Greenhouse devolve o quadro INTEIRO: vaga que não está nele não está publicada.
 * Só vale para quadro que respondeu; quadro caído não encerra nada.
 */
import type { SupabaseRest } from '../db/supabase.ts';
import { QUADROS_GREENHOUSE, type QuadroGreenhouse } from '../config/greenhouse.ts';
import { buscarNoGreenhouse } from '../fontes/greenhouse.ts';
import { GREENHOUSE, gravarNoCache, registrarColeta } from '../fontes/gupy-cache.ts';

export interface PlacarGreenhouse {
  ok: number;
  falhou: number;
  /** Publicadas na janela e com local que serve. */
  naJanela: number;
  descartadas: number;
  gravadas: number;
  encerradas: number;
  reabertas: number;
}

/** `ats_greenhouse:<id>` ou `ats_greenhouse:<id>@<cidade>` → id. */
export function idDaChave(dedupKey: string): string | null {
  return /^ats_greenhouse:(\d+)(?:@|$)/.exec(dedupKey)?.[1] ?? null;
}

/**
 * Quais linhas encerrar e quais reabrir. O id da vaga no Greenhouse é único
 * entre empresas, então basta a união dos quadros — mas só quando TODOS
 * responderam: com um quadro caído, as vagas dele pareceriam encerradas.
 */
export function decidirEncerramento(
  linhas: Array<{ id: number; dedup_key: string; encerrada_em: string | null }>,
  idsNoQuadro: Set<string>,
): { encerrar: number[]; reabrir: number[] } {
  const encerrar: number[] = [];
  const reabrir: number[] = [];
  for (const l of linhas) {
    const id = idDaChave(l.dedup_key);
    if (!id) continue;
    const publicada = idsNoQuadro.has(id);
    if (!publicada && !l.encerrada_em) encerrar.push(l.id);
    if (publicada && l.encerrada_em) reabrir.push(l.id);
  }
  return { encerrar, reabrir };
}

export async function coletarGreenhouse(
  db: SupabaseRest,
  opcoes: { seco: boolean; agora?: Date; quadros?: QuadroGreenhouse[]; log?: (m: string) => void },
): Promise<PlacarGreenhouse> {
  const agora = opcoes.agora ?? new Date();
  const log = opcoes.log ?? console.log;
  const desde = new Date(agora.getTime() - 7 * 864e5);
  const placar: PlacarGreenhouse = { ok: 0, falhou: 0, naJanela: 0, descartadas: 0, gravadas: 0, encerradas: 0, reabertas: 0 };
  const idsNoQuadro = new Set<string>();

  for (const quadro of opcoes.quadros ?? QUADROS_GREENHOUSE) {
    const r = await buscarNoGreenhouse(quadro, desde);
    // Uma requisição por segundo, a mesma educação do InfoJobs.
    await new Promise((ok) => setTimeout(ok, 1000));
    if (r.falhou) {
      placar.falhou++;
      log(`  ${quadro.slug}: FALHOU`);
      continue;
    }
    placar.ok++;
    placar.naJanela += r.vagas.length;
    placar.descartadas += r.descartadas;
    for (const id of r.idsNoQuadro) idsNoQuadro.add(id);

    let gravadas = 0;
    if (!opcoes.seco && r.vagas.length > 0) {
      const g = await gravarNoCache(db, r.vagas, { cargoBusca: `quadro:${quadro.slug}`, cidadeBusca: null, soRemoto: false }, GREENHOUSE);
      gravadas = g.vagasGravadas;
      placar.gravadas += gravadas;
    }
    if (!opcoes.seco) await registrarColeta(db, `quadro:${quadro.slug}`, null, false, r.vistos, gravadas, GREENHOUSE);
    log(`  ${quadro.slug}: ${r.vistos} no quadro, ${r.vagas.length} na janela, ${r.descartadas} descartadas, ${gravadas} linhas novas`);
  }

  // Encerramento: linhas ativas cujo id sumiu do quadro. Só com todos os quadros de pé.
  if (placar.falhou > 0) {
    log(`  encerramento pulado: ${placar.falhou} quadro(s) não responderam`);
    return placar;
  }
  const linhas = await db.selectTodos<{ id: number; dedup_key: string; encerrada_em: string | null }>(
    'jobs',
    `select=id,dedup_key,encerrada_em&fonte=eq.ats_greenhouse&ativo=is.true&data_publicacao=gte.${desde.toISOString()}&order=id`,
  );
  const { encerrar, reabrir } = decidirEncerramento(linhas, idsNoQuadro);
  placar.encerradas = encerrar.length;
  placar.reabertas = reabrir.length;
  if (!opcoes.seco) {
    for (let i = 0; i < encerrar.length; i += 200) {
      await db.update('jobs', `id=in.(${encerrar.slice(i, i + 200).join(',')})`, { encerrada_em: agora.toISOString() });
    }
    for (let i = 0; i < reabrir.length; i += 200) {
      await db.update('jobs', `id=in.(${reabrir.slice(i, i + 200).join(',')})`, { encerrada_em: null });
    }
  }
  return placar;
}
