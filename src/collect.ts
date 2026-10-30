/**
 * Entrada do coletor.
 *
 * Ordem que importa:
 *   1. reserva créditos (atômico) antes de qualquer chamada;
 *   2. consulta a Serper respeitando o que foi reservado;
 *   3. resolve o redirect `google.com/goto` que a Serper às vezes devolve;
 *   4. normaliza;
 *   5. deduplica por hash da URL canônica;
 *   6. grava o que é novo;
 *   7. devolve o que não usou.
 *
 * O que este arquivo NÃO faz: classificar. Nada aqui decide se o resultado é
 * vaga de verdade, qual a senioridade ou se o cargo bate. `raw_results` guarda
 * tudo cru com `processado = false`; o Passo 3 lê de lá.
 *
 * Diferença para a versão anterior (PSE): o saldo da Serper é ACUMULADO, não
 * uma cota que zera à meia-noite. A chave de saldo é fixa ('serper'), e o que
 * protege de uma rodada com bug torrar tudo é `SERPER_ORCAMENTO_POR_RUN`.
 */
import { carregarConfig } from './config/env.ts';
import {
  ALVOS,
  alvosAtivos,
  custoDoCiclo,
  expandirTodos,
  JANELA,
  type Alvo,
  type Consulta,
} from './config/alvos.ts';
import { hashesExistentes, SupabaseRest } from './db/supabase.ts';
import { dedupPorHash, separarNovos } from './dedupe.ts';
import { log } from './logger.ts';
import { paraLinha, type ResultadoNormalizado } from './normalize/resultado.ts';
import { ArquivoQuotaStore, SupabaseQuotaStore, type QuotaStore } from './quota/store.ts';
import { SerperCliente, SerperCreditosError, SerperErroFatal } from './serper/cliente.ts';
import { normalizarPaginaSerper } from './serper/normalizar.ts';
import { ehRedirectGoogle, resolverRedirectGoogle } from './serper/redirect.ts';
import type { Combinacao } from './tipos.ts';

/** Chave do saldo no Postgres. Fixa: os créditos da Serper não renovam. */
const CHAVE_SALDO = 'serper';

interface Argumentos {
  dryRun: boolean;
  semBanco: boolean;
  limite: number | null;
  alvo: string | null;
  paginas: number | null;
}

function lerArgumentos(argv: string[]): Argumentos {
  const args: Argumentos = {
    dryRun: false,
    semBanco: false,
    limite: null,
    alvo: null,
    paginas: null,
  };

  for (const bruto of argv) {
    if (bruto === '--dry-run') args.dryRun = true;
    else if (bruto === '--no-db') args.semBanco = true;
    else if (bruto.startsWith('--limite=')) {
      const n = Number(bruto.slice('--limite='.length));
      if (!Number.isFinite(n) || n < 1) throw new Error(`--limite inválido: ${bruto}`);
      args.limite = Math.floor(n);
    } else if (bruto.startsWith('--paginas=')) {
      const n = Number(bruto.slice('--paginas='.length));
      if (!Number.isFinite(n) || n < 1 || n > 10) throw new Error(`--paginas fora de 1..10`);
      args.paginas = Math.floor(n);
    } else if (bruto.startsWith('--alvo=')) {
      args.alvo = bruto.slice('--alvo='.length);
    } else {
      throw new Error(`argumento desconhecido: ${bruto}`);
    }
  }

  return args;
}

function filtrarAlvos(alvoId: string | null): Alvo[] {
  const ativos = alvosAtivos(ALVOS);
  if (!alvoId) return ativos;
  const escolhidos = ativos.filter((a) => a.id === alvoId);
  if (escolhidos.length === 0) {
    throw new Error(
      `alvo "${alvoId}" não existe ou está inativo. Disponíveis: ${ativos.map((a) => a.id).join(', ')}`,
    );
  }
  return escolhidos;
}

/**
 * `normalizarPaginaSerper` espera o formato antigo de combo. A ponte é local e
 * explícita para não espalhar o formato de configuração pelo pipeline.
 */
function comboDaConsulta(c: Consulta): Combinacao {
  return {
    id: c.alvo.id,
    cargo: c.alvo.cargo,
    modelo: c.recorte === 'remoto' ? 'remoto' : 'qualquer',
    localizacao: c.recorte === 'cidade' ? c.alvo.cidade : null,
    fonte: c.bloco,
    dork: c.dork,
    dateRestrict: 'd7',
    paginas: 1,
    ativo: true,
  };
}

interface Resumo {
  consultasPlanejadas: number;
  creditosReservados: number;
  creditosConsumidos: number;
  itensBrutos: number;
  descartados: number;
  duplicadosNaRodada: number;
  jaNoBanco: number;
  novos: number;
  gravados: number;
  erros: number;
  /** Links `google.com/goto` que não resolveram: gravados como `desconhecida`. */
  redirectsNaoResolvidos: number;
  saldoEsgotado: boolean;
}

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2));
  const precisaDb = !args.semBanco && !args.dryRun;
  const config = carregarConfig({ precisaDb, precisaFonte: !args.dryRun });

  const paginas = args.paginas ?? config.paginasPorConsulta;
  const alvos = filtrarAlvos(args.alvo);
  let consultas = expandirTodos(paginas, alvos);
  if (args.limite !== null) consultas = consultas.slice(0, args.limite);

  log.info('ciclo planejado', {
    alvos: alvos.length,
    consultas: consultas.length,
    paginas,
    custoDoCicloCompleto: custoDoCiclo(paginas, ALVOS),
    tetoPorRun: config.orcamentoPorRun,
    janela: JANELA,
  });

  if (args.dryRun) {
    for (const c of consultas) {
      console.log(`[${c.alvo.id}] ${c.bloco}/${c.recorte} p${c.pagina}\n    ${c.dork}`);
    }
    log.info('dry-run: nenhuma consulta enviada, nenhum crédito consumido');
    return 0;
  }

  const db = precisaDb ? new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey) : null;
  const store: QuotaStore = db
    ? new SupabaseQuotaStore(db)
    : new ArquivoQuotaStore('.quota/serper.json');

  const antes = await store.estado(CHAVE_SALDO, config.creditosTotais);
  log.info('saldo antes da rodada', {
    consumidos: antes.consumidas,
    limite: antes.limite,
    restante: antes.limite - antes.consumidas,
  });

  const pedidos = Math.min(consultas.length, config.orcamentoPorRun);
  const reservados = await store.reservar(CHAVE_SALDO, pedidos, config.creditosTotais);

  if (reservados === 0) {
    log.warn('saldo de créditos esgotado: nada a fazer', {
      consumidos: antes.consumidas,
      limite: antes.limite,
    });
    return 0;
  }
  if (reservados < pedidos) {
    log.warn('reserva parcial: rodada será truncada', { pedidos, reservados });
  }

  const cliente = new SerperCliente({
    key: config.serperKey,
    orcamento: reservados,
    intervaloMs: config.intervaloMs,
    tentativas: config.tentativas,
  });

  const resumo: Resumo = {
    consultasPlanejadas: consultas.length,
    creditosReservados: reservados,
    creditosConsumidos: 0,
    itensBrutos: 0,
    descartados: 0,
    duplicadosNaRodada: 0,
    jaNoBanco: 0,
    novos: 0,
    gravados: 0,
    erros: 0,
    redirectsNaoResolvidos: 0,
    saldoEsgotado: false,
  };

  const coletados: ResultadoNormalizado[] = [];
  const inicio = Date.now();

  // Quando uma página vem vazia, as seguintes do mesmo dork também virão —
  // seguir paginando ali só queima crédito.
  const dorksEsgotados = new Set<string>();

  try {
    for (const c of consultas.slice(0, reservados)) {
      if (cliente.restante <= 0) break;
      if (dorksEsgotados.has(c.dork)) continue;

      try {
        const { organicos } = await cliente.buscar(c.dork, { pagina: c.pagina, tbs: JANELA });
        resumo.itensBrutos += organicos.length;

        if (organicos.length === 0) {
          dorksEsgotados.add(c.dork);
          continue;
        }

        const resolvidos = await Promise.all(
          organicos.map(async (item) => {
            if (!item.link || !ehRedirectGoogle(item.link)) return item;
            const destino = await resolverRedirectGoogle(item.link);
            if (!destino) {
              resumo.redirectsNaoResolvidos++;
              return item;
            }
            return { ...item, link: destino, linkGoogle: item.link };
          }),
        );

        const { normalizados, descartados } = normalizarPaginaSerper(resolvidos, {
          combo: comboDaConsulta(c),
          pagina: c.pagina,
        });
        resumo.descartados += descartados;
        coletados.push(...normalizados);

        log.info('consulta concluída', {
          alvo: c.alvo.id,
          bloco: c.bloco,
          recorte: c.recorte,
          pagina: c.pagina,
          itens: organicos.length,
          creditos: `${cliente.consumidos}/${reservados}`,
        });
      } catch (erro) {
        if (erro instanceof SerperCreditosError) {
          resumo.saldoEsgotado = true;
          log.warn('parando a rodada: créditos esgotados', { erro: String(erro) });
          break;
        }
        resumo.erros++;
        if (erro instanceof SerperErroFatal) {
          log.error('consulta rejeitada pela Serper (dork ou credencial)', {
            alvo: c.alvo.id,
            erro: String(erro),
          });
        } else {
          log.error('consulta falhou após as tentativas', {
            alvo: c.alvo.id,
            erro: String(erro),
          });
        }
      }
    }
  } finally {
    resumo.creditosConsumidos = cliente.consumidos;
    const sobra = reservados - cliente.consumidos;
    if (sobra > 0) {
      await store.devolver(CHAVE_SALDO, sobra);
      log.debug('créditos devolvidos', { sobra });
    }
  }

  // --- dedup e gravação ----------------------------------------------------

  const { unicos, duplicados } = dedupPorHash(coletados);
  resumo.duplicadosNaRodada = duplicados.length;

  let paraGravar = unicos;
  if (db) {
    const conhecidos = await hashesExistentes(
      db,
      unicos.map((u) => u.urlHash),
    );
    const { novos, jaConhecidos } = separarNovos(unicos, conhecidos);
    resumo.jaNoBanco = jaConhecidos.length;
    paraGravar = novos;
  }
  resumo.novos = paraGravar.length;

  if (db && paraGravar.length > 0) {
    // A constraint UNIQUE é a rede de segurança: duas rodadas simultâneas podem
    // ter passado pelo separarNovos com o mesmo hash.
    const gravados = await db.insert<{ id: number }>('raw_results', paraGravar.map(paraLinha), {
      ignorarDuplicados: true,
      conflito: 'url_hash',
      retornar: true,
    });
    resumo.gravados = gravados.length;
  }

  const depois = await store.estado(CHAVE_SALDO, config.creditosTotais);

  if (db) {
    await db.insert('collection_runs', [
      {
        iniciado_em: new Date(inicio).toISOString(),
        duracao_ms: Date.now() - inicio,
        dia_quota: new Date().toISOString().slice(0, 10),
        queries_planejadas: resumo.consultasPlanejadas,
        queries_consumidas: resumo.creditosConsumidos,
        itens_brutos: resumo.itensBrutos,
        duplicados_rodada: resumo.duplicadosNaRodada,
        ja_no_banco: resumo.jaNoBanco,
        novos: resumo.gravados,
        erros: resumo.erros,
        quota_esgotada: resumo.saldoEsgotado,
      },
    ]);
  }

  log.info('rodada concluída', { ...resumo, duracaoMs: Date.now() - inicio });
  log.info('saldo depois da rodada', {
    consumidos: depois.consumidas,
    limite: depois.limite,
    restante: depois.limite - depois.consumidas,
  });

  // Erro em consulta isolada não derruba a rodada; falha total, sim.
  if (resumo.erros > 0 && resumo.creditosConsumidos === resumo.erros) {
    log.error('todas as consultas falharam');
    return 1;
  }
  return 0;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    log.error('rodada abortada', { erro: erro instanceof Error ? erro.message : String(erro) });
    if (erro instanceof Error && erro.stack) console.error(erro.stack);
    process.exitCode = 1;
  });
