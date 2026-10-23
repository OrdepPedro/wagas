// Quantas vagas repetidas o feed mostraria hoje (trava 5). Zero requisição externa.
//
// Mede sobre as linhas que o feed serve (ativas, na janela de 7 dias), por
// três chaves cada vez mais largas, para separar "mesma vaga" de "vagas
// parecidas da mesma empresa":
//
//   url       a mesma URL canônica gravada duas vezes — bug de gravação
//   estrita   empresa + cargo + cidade (ou remoto) + dia de publicação
//   larga     empresa + cargo — a chave de gravação de hoje (`dedup_key`)
//
//   node --env-file=.env scripts/medir-duplicatas.ts

import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { normalizarCargo } from '../src/dedupe.ts';

interface Linha {
  id: number; fonte: string; empresa: string; cargo: string; url: string;
  cidade_slug: string | null; modelo: string | null; data_referencia: string; dedup_key: string;
}

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);
const sete = new Date(Date.now() - 7 * 864e5).toISOString();
const linhas = await db.selectTodos<Linha>(
  'jobs',
  `select=id,fonte,empresa,cargo,url,cidade_slug,modelo,data_referencia,dedup_key&ativo=eq.true&data_referencia=gte.${sete}&order=id`,
);

const emp = (e: string) => e.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(ltda|s\.?a|eireli|me|grupo|cia)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const semEmpresa = (l: Linha) => /^(nao identificada|empresa confidencial|confidencial)$/.test(emp(l.empresa));

const chaves: Record<string, (l: Linha) => string | null> = {
  url: (l) => l.url,
  estrita: (l) => semEmpresa(l) ? null
    : `${emp(l.empresa)}|${normalizarCargo(l.cargo)}|${l.modelo === 'remoto' ? 'remoto' : l.cidade_slug}|${l.data_referencia.slice(0, 10)}`,
  larga: (l) => semEmpresa(l) ? null : `${emp(l.empresa)}|${normalizarCargo(l.cargo)}`,
};

console.log(`${linhas.length} linhas na janela; ${linhas.filter(semEmpresa).length} sem empresa (nunca colapsam)`);
for (const [nome, f] of Object.entries(chaves)) {
  const grupos = new Map<string, Linha[]>();
  for (const l of linhas) { const k = f(l); if (k) grupos.set(k, [...(grupos.get(k) ?? []), l]); }
  const repetidos = [...grupos.values()].filter((g) => g.length > 1);
  const sobra = repetidos.reduce((n, g) => n + g.length - 1, 0);
  const entreFontes = repetidos.filter((g) => new Set(g.map((l) => l.fonte)).size > 1).length;
  console.log(`\n${nome}: ${repetidos.length} grupos repetidos, ${sobra} cartões a mais, ${entreFontes} grupos entre fontes diferentes`);
  for (const g of repetidos.sort((a, b) => b.length - a.length).slice(0, 5)) {
    console.log(`  ${g.length}× ${g[0]!.empresa} | ${g[0]!.cargo} | ${g.map((l) => `${l.fonte}:${l.cidade_slug ?? l.modelo}:${l.data_referencia.slice(5, 10)}`).join(' ')}`);
  }
}
