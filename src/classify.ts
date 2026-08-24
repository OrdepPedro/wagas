/**
 * Entrada do classificador (Passo 3).
 *
 *   1. lê de `raw_results` o que ainda não foi classificado;
 *   2. pré-filtro determinístico, de graça;
 *   3. LLM no que sobrou, em lote;
 *   4. grava as aprovadas em `jobs` e carimba o motivo em `raw_results`.
 *
 * O que este arquivo NÃO faz: buscar. Nada aqui chama a Serper. A separação é a
 * mesma regra que vale para o coletor — busca popula o cache, o resto lê o
 * cache — e aqui ela também protege o saldo: reclassificar é barato, recoletar
 * não.
 *
 * Sem chave de LLM configurada, roda só o pré-filtro e reporta o que TERIA ido
 * para o modelo. Serve para conferir o custo antes de gastar cota.
 */
import { carregarConfigClassificador } from './config/env.ts';
import { classificar, resumir } from './classificar/classificador.ts';
import { cadeiaDoAmbiente } from './classificar/llm.ts';
import { gravar, lerPendentes } from './classificar/persistencia.ts';
import { SupabaseRest } from './db/supabase.ts';
import { log } from './logger.ts';

interface Argumentos {
  dryRun: boolean;
  limite: number | null;
  soPrefiltro: boolean;
}

function lerArgumentos(argv: string[]): Argumentos {
  const args: Argumentos = { dryRun: false, limite: null, soPrefiltro: false };

  for (const bruto of argv) {
    if (bruto === '--dry-run') args.dryRun = true;
    else if (bruto === '--so-prefiltro') args.soPrefiltro = true;
    else if (bruto.startsWith('--limite=')) {
      const n = Number(bruto.slice('--limite='.length));
      if (!Number.isFinite(n) || n < 1) throw new Error(`--limite inválido: ${bruto}`);
      args.limite = Math.floor(n);
    } else {
      throw new Error(`argumento desconhecido: ${bruto}`);
    }
  }

  return args;
}

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2));
  const config = carregarConfigClassificador({ precisaDb: true });
  const limite = args.limite ?? config.limite;

  const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);
  const pendentes = await lerPendentes(db, limite);

  if (pendentes.length === 0) {
    log.info('nada pendente em raw_results');
    return 0;
  }

  const provedor = args.soPrefiltro ? null : cadeiaDoAmbiente(config);
  if (!provedor && !args.soPrefiltro) {
    log.warn('nenhuma chave de LLM configurada: rodando só o pré-filtro', {
      configure: 'GEMINI_KEY ou GROQ_KEY',
    });
  }

  log.info('classificação planejada', {
    pendentes: pendentes.length,
    limite,
    provedor: provedor?.nome ?? 'nenhum',
    lote: config.tamanhoDoLote,
    confiancaMinima: config.confiancaMinima,
  });

  const inicio = Date.now();
  const decisoes = await classificar(pendentes, provedor, {
    tamanhoDoLote: config.tamanhoDoLote,
    confiancaMinima: config.confiancaMinima,
  });
  const resumo = resumir(decisoes);

  if (args.dryRun) {
    for (const d of decisoes) {
      console.log(
        `[${d.veredito}] ${d.motivo ?? '-'} (${d.estagio})\n    ${d.candidato.titulo}\n    ${d.detalhe}`,
      );
    }
    log.info('dry-run: nada gravado', { ...resumo, duracaoMs: Date.now() - inicio });
    return 0;
  }

  const gravacao = await gravar(db, decisoes);

  log.info('classificação concluída', {
    ...resumo,
    ...gravacao,
    duracaoMs: Date.now() - inicio,
  });

  // Rodada em que TUDO deu erro é falha de infraestrutura: precisa falhar alto,
  // senão o Actions fica verde enquanto a fila só cresce.
  if (resumo.erros === resumo.total && resumo.total > 0) {
    log.error('nenhum candidato foi classificado');
    return 1;
  }
  return 0;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    log.error('classificação abortada', { erro: erro instanceof Error ? erro.message : String(erro) });
    if (erro instanceof Error && erro.stack) console.error(erro.stack);
    process.exitCode = 1;
  });
