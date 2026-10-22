/**
 * Devolve `raw_results` à fila e limpa `jobs`, para a classificação rodar de novo.
 *
 * Por que apagar `jobs` em vez de só reclassificar por cima: a gravação usa
 * `on conflict (dedup_key) do nothing`. Se as linhas velhas ficassem, a vaga
 * reclassificada colidiria com a versão antiga e o insert seria ignorado em
 * silêncio — o banco continuaria com o veredito pré-portão e o relatório diria
 * que deu tudo certo. Pior ainda: uma vaga REPROVADA pelo portão de local
 * continuaria em `jobs`, porque nada a removeria.
 *
 * `raw_results` não é tocado além dos campos de classificação. Ele é a fonte de
 * verdade e recoletá-lo custaria crédito da Serper; reclassificar custa cota
 * gratuita de LLM. Essa assimetria é o motivo de as duas tabelas existirem
 * separadas.
 *
 *   node --env-file-if-exists=.env scripts/reclassificar.ts [--aplicar]
 *
 * Sem `--aplicar`, só conta o que faria. Com `--aplicar`, grava um backup de
 * `jobs` em disco ANTES de apagar — a classificação não é reprodutível
 * (achado 11: o mesmo lote dá resultado diferente com temperature 0), então a
 * linha apagada não é recuperável rodando de novo.
 */
import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { log } from '../src/logger.ts';
import { writeFile } from 'node:fs/promises';

const aplicar = process.argv.includes('--aplicar');

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

const jobs = await db.select<Record<string, unknown>>('jobs', 'select=*&order=id.asc');
const brutos = await db.select<{ id: number; processado: boolean }>(
  'raw_results',
  'select=id,processado',
);

console.log(`jobs a apagar: ${jobs.length}`);
console.log(`raw_results a devolver para a fila: ${brutos.length}`);

if (!aplicar) {
  console.log('\nnada foi feito. rode de novo com --aplicar');
  process.exit(0);
}

const arquivo = `backup-jobs-${new Date().toISOString().slice(0, 10)}.json`;
await writeFile(arquivo, JSON.stringify(jobs, null, 1), 'utf8');
log.info('backup gravado', { arquivo, linhas: jobs.length });

// `id=gt.0` é o filtro obrigatório do `remove`: cobre tudo, mas escrito de
// propósito, para não existir caminho de DELETE sem where neste código.
await db.remove('jobs', 'id=gt.0');
log.info('jobs apagada', { linhas: jobs.length });

const ids = brutos.map((b) => b.id);
for (let i = 0; i < ids.length; i += 150) {
  const lote = ids.slice(i, i + 150);
  await db.update('raw_results', `id=in.(${lote.join(',')})`, {
    processado: false,
    classificacao: null,
    classificacao_motivo: null,
    classificacao_estagio: null,
    classificado_em: null,
    classificador: null,
  });
}
log.info('raw_results devolvida para a fila', { linhas: ids.length });

console.log(`\npronto. backup em ${arquivo}`);
console.log('agora: npm run classify -- --limite=400');
