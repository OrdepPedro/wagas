// O que a dedup na GRAVAÇÃO jogou fora (trava 5). Zero requisição externa.
//
// `jobs.dedup_key` (empresa + cargo) é única, então vaga com chave repetida
// é descartada no insert. Se as descartadas forem a mesma vaga, ótimo. Se
// forem vagas diferentes — a mesma empresa e cargo em OUTRA cidade —, a pessoa
// da segunda cidade perde a vaga do feed dela.
//
//   node --env-file=.env scripts/medir-descartes.ts

import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { normalizarLocal } from '../src/normalize/local.ts';
import { chaveDedupVaga } from '../src/dedupe.ts';

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);
const sete = new Date(Date.now() - 7 * 864e5).toISOString();

const aprovados = await db.selectTodos<{ id: number; fonte: string; titulo: string; payload: any; data_coleta: string }>(
  'raw_results',
  `select=id,fonte,titulo,payload,data_coleta&classificacao=eq.aprovado&fonte=in.(ats_gupy,portal_infojobs)&data_coleta=gte.${sete}&order=id`,
);
const comJob = new Set(
  (await db.selectTodos<{ raw_result_id: number }>('jobs', 'select=raw_result_id&raw_result_id=not.is.null&order=id')).map((j) => j.raw_result_id),
);
const jobs = await db.selectTodos<{ dedup_key: string; cidade_slug: string | null; modelo: string | null; fonte: string }>(
  'jobs', 'select=dedup_key,cidade_slug,modelo,fonte&order=id',
);
const porChave = new Map(jobs.map((j) => [j.dedup_key, j]));

// Cidade da linha bruta, pelo mesmo caminho que gravou `jobs`.
function cidadeDo(r: { fonte: string; payload: any }): string | null {
  const p = r.payload ?? {};
  if (r.fonte === 'ats_gupy') return normalizarLocal([p.city, p.state].filter(Boolean).join(' - ') || null).cidadeSlug;
  const a = p.jobLocation?.address;
  return a ? normalizarLocal([a.addressLocality, a.addressRegion].filter(Boolean).join(' - ')).cidadeSlug : null;
}
function remoto(r: { fonte: string; payload: any }): boolean {
  const p = r.payload ?? {};
  return p.workplaceType === 'remote' || p.isRemoteWork === true || p.origem === 'bloco_html';
}

const descartados = aprovados.filter((r) => !comJob.has(r.id));
console.log(`${aprovados.length} aprovados (Gupy + InfoJobs, 7 dias); ${descartados.length} sem linha em jobs (${Math.round(100 * descartados.length / aprovados.length)}%)`);

// Para cada descartado, a linha que ficou no lugar dele está em outra cidade?
// Mesma chave que a gravação calculou. A vaga lida do bloco HTML não guarda a
// empresa no payload, e cai em "sem como comparar".
function dedupKeyDe(r: { fonte: string; titulo: string; payload: any }): string {
  const p = r.payload ?? {};
  const empresa = r.fonte === 'ats_gupy' ? p.careerPageName : p.hiringOrganization?.name;
  return chaveDedupVaga(empresa?.trim() || 'não identificada', r.titulo);
}
let mesmaCidade = 0, outraCidade = 0, semComparar = 0;
const exemplos: string[] = [];
for (const r of descartados) {
  const vencedora = porChave.get(dedupKeyDe(r));
  const cidade = remoto(r) ? 'remoto' : cidadeDo(r);
  const cidadeVencedora = vencedora ? (vencedora.modelo === 'remoto' ? 'remoto' : vencedora.cidade_slug) : null;
  if (!vencedora || !cidade || !cidadeVencedora) { semComparar++; continue; }
  if (cidade === cidadeVencedora) mesmaCidade++;
  else {
    outraCidade++;
    if (exemplos.length < 8) exemplos.push(`  ${r.titulo.slice(0, 50)} | descartada: ${cidade} | ficou: ${cidadeVencedora} (${r.fonte} vs ${vencedora.fonte})`);
  }
}
console.log(`  mesma cidade da que ficou (provável mesma vaga): ${mesmaCidade}`);
console.log(`  OUTRA cidade (vaga perdida para quem mora lá): ${outraCidade}`);
console.log(`  sem como comparar: ${semComparar}`);
console.log(exemplos.join('\n'));
