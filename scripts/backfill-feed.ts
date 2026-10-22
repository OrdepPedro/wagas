/**
 * Preenche as colunas da migration 0004 nas linhas de `jobs` que já existiam.
 *
 * Custo zero: nada aqui chama LLM ou SERP. Tudo é recalculado a partir do que
 * já está gravado — o cargo extraído, a localização escrita pelo modelo, e o
 * título/snippet da linha de origem em `raw_results`.
 *
 * O que ele NÃO faz, e é importante não confundir: ele não roda o portão de
 * local. As 197 linhas de 24/08 foram classificadas antes de o portão existir,
 * e nenhuma delas tem julgamento do modelo sobre local. O que o backfill
 * consegue é a segunda linha de defesa, determinística: onde a localização diz
 * explicitamente que a vaga é de fora do Brasil, a linha sai do feed
 * (`ativo = false`).
 *
 * `local_avaliado` NÃO é escrito aqui. Quem sabe se o portão julgou a linha é o
 * classificador, e um backfill que zerasse essa coluna apagaria justamente a
 * informação que ela existe para guardar.
 *
 *   node --env-file-if-exists=.env scripts/backfill-feed.ts [--aplicar]
 *
 * Sem `--aplicar` só mede e imprime. É o modo de conferir antes de escrever.
 */
import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { classesDeFamilia, tokensDeFamilia } from '../src/classificar/familia.ts';
import { modeloDoTexto, normalizarLocal } from '../src/normalize/local.ts';
import { log } from '../src/logger.ts';

interface LinhaJob {
  id: number;
  raw_result_id: number | null;
  cargo: string;
  modelo: string | null;
  localizacao: string | null;
  fonte: string;
}

interface LinhaRaw {
  id: number;
  titulo: string;
  snippet: string | null;
}

const aplicar = process.argv.includes('--aplicar');

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

const jobs = await db.select<LinhaJob>(
  'jobs',
  'select=id,raw_result_id,cargo,modelo,localizacao,fonte&order=id.asc',
);
log.info('linhas lidas', { jobs: jobs.length });

// Título e snippet da origem: é de onde o modelo de trabalho pode ser lido
// quando o LLM não respondeu.
const idsRaw = jobs.map((j) => j.raw_result_id).filter((id): id is number => id !== null);
const brutos = new Map<number, LinhaRaw>();
for (let i = 0; i < idsRaw.length; i += 150) {
  const lote = idsRaw.slice(i, i + 150);
  const linhas = await db.select<LinhaRaw>(
    'raw_results',
    `select=id,titulo,snippet&id=in.(${lote.join(',')})`,
  );
  for (const linha of linhas) brutos.set(linha.id, linha);
}

/** Mesma leitura por fonte que o classificador faz — ver `textoConfiavel`. */
function textoConfiavel(fonte: string, titulo: string, snippet: string): string[] {
  if (fonte === 'linkedin_job') return [titulo];
  if (fonte === 'linkedin_post') return [snippet];
  return [titulo, snippet];
}

const conta = {
  total: jobs.length,
  modeloRecuperado: 0,
  modeloAindaNulo: 0,
  cidadeIdentificada: 0,
  paisBrConfirmado: 0,
  paisBrDesconhecido: 0,
  desativadasPorPais: 0,
};
const porCidade = new Map<string, number>();

for (const job of jobs) {
  const bruto = job.raw_result_id !== null ? brutos.get(job.raw_result_id) : undefined;
  const local = normalizarLocal(job.localizacao);

  const modelo =
    job.modelo ??
    (bruto
      ? modeloDoTexto(...textoConfiavel(job.fonte, bruto.titulo, bruto.snippet ?? ''))
      : null);

  if (!job.modelo && modelo) conta.modeloRecuperado++;
  if (!modelo) conta.modeloAindaNulo++;
  if (local.cidadeSlug) {
    conta.cidadeIdentificada++;
    porCidade.set(local.cidadeSlug, (porCidade.get(local.cidadeSlug) ?? 0) + 1);
  }
  if (local.paisBr === true) conta.paisBrConfirmado++;
  if (local.paisBr === null) conta.paisBrDesconhecido++;

  const campos: Record<string, unknown> = {
    familia_tokens: tokensDeFamilia(job.cargo),
    familia_classes: classesDeFamilia(job.cargo),
    cidade_slug: local.cidadeSlug,
    uf: local.uf,
    pais_br: local.paisBr,
    modelo,
  };

  // Vaga comprovadamente de fora do Brasil não é vaga ruim: é vaga de outro
  // produto. Sai do feed sem ser apagada, para continuar auditável.
  if (local.paisBr === false) {
    campos['ativo'] = false;
    conta.desativadasPorPais++;
  }

  if (aplicar) await db.update('jobs', `id=eq.${job.id}`, campos);
}

console.log(JSON.stringify({ modo: aplicar ? 'aplicado' : 'simulação', ...conta }, null, 2));
console.log(
  'cidades:',
  [...porCidade.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
);
if (!aplicar) console.log('\nnada foi gravado. rode de novo com --aplicar');
