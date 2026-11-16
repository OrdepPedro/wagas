// Coleta dos quadros do Greenhouse, à mão (achado 36).
//
//   npm run greenhouse              # grava
//   npm run greenhouse -- --seco    # só mede, sem gravar
//
// A coleta diária chama a mesma função; este script existe para rodar e medir
// sem esperar a madrugada. Sem a migration 0022, o insert é recusado pelo
// `check` de `fonte`.

import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { coletarGreenhouse } from '../src/coleta/greenhouse.ts';

const seco = process.argv.includes('--seco');
const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

console.log(`Greenhouse${seco ? ' — SECO, sem gravar' : ''}`);
const p = await coletarGreenhouse(db, { seco });
console.log(
  `Greenhouse: ${p.ok} quadros ok, ${p.falhou} falharam, ${p.naJanela} vagas na janela, ` +
    `${p.descartadas} descartadas, ${p.gravadas} linhas novas, ${p.encerradas} encerradas, ${p.reabertas} reabertas`,
);
if (p.falhou > 0 && p.falhou >= p.ok) process.exit(1);
