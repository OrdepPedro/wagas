/**
 * Devolve a `jobs.data_coleta` a data real, vinda de `raw_results`.
 *
 * Conserta um defeito introduzido na reclassificação de 26/08: `paraLinhaJob`
 * não gravava `data_coleta`, então o Postgres aplicava `default now()`. Como a
 * reclassificação apaga e reinsere `jobs`, o acervo inteiro foi carimbado como
 * "coletado agora".
 *
 * O estrago não é cosmético. `data_referencia` é `coalesce(data_publicacao,
 * data_coleta)`, e é ela que o feed usa para a janela de 7 dias E para a
 * ordenação. Com a data errada, vaga de 24/08 sobrevive até 02/09 e ainda
 * aparece acima de vaga com data de publicação de verdade.
 *
 * Custo zero: só copia o que já está gravado na tabela de origem.
 */
import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';

const aplicar = process.argv.includes('--aplicar');
const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

const jobs = await db.select<{ id: number; raw_result_id: number | null; data_coleta: string }>(
  'jobs',
  'select=id,raw_result_id,data_coleta&raw_result_id=not.is.null&order=id.asc',
);

const ids = jobs.map((j) => j.raw_result_id!).filter(Boolean);
const verdade = new Map<number, string>();
for (let i = 0; i < ids.length; i += 150) {
  const lote = ids.slice(i, i + 150);
  for (const r of await db.select<{ id: number; data_coleta: string }>(
    'raw_results',
    `select=id,data_coleta&id=in.(${lote.join(',')})`,
  )) {
    verdade.set(r.id, r.data_coleta);
  }
}

// Um PATCH por data distinta, não por linha.
const porData = new Map<string, number[]>();
let iguais = 0;

for (const j of jobs) {
  const real = verdade.get(j.raw_result_id!);
  if (!real) continue;
  if (Date.parse(real) === Date.parse(j.data_coleta)) {
    iguais++;
    continue;
  }
  const lista = porData.get(real) ?? [];
  lista.push(j.id);
  porData.set(real, lista);
}

const aCorrigir = [...porData.values()].reduce((n, l) => n + l.length, 0);
console.log(`jobs com origem: ${jobs.length} | já corretas: ${iguais} | a corrigir: ${aCorrigir}`);

for (const [data, lista] of porData) {
  console.log(`  ${data.slice(0, 16)} <- ${lista.length} linha(s)`);
  if (aplicar) {
    for (let i = 0; i < lista.length; i += 150) {
      await db.update('jobs', `id=in.(${lista.slice(i, i + 150).join(',')})`, {
        data_coleta: data,
      });
    }
  }
}

console.log(aplicar ? '\naplicado.' : '\nnada gravado. rode com --aplicar');
