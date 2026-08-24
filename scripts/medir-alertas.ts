/**
 * Medição do Google Alerts como fonte — o experimento que decide se o Passo 2
 * pode seguir sem a PSE.
 *
 * Roda sem chave, sem cota, sem banco. Lê os feeds declarados em
 * src/config/alertas.ts, normaliza, deduplica e imprime os números que
 * importam. Rode de novo daqui a 7 dias com --comparar=<arquivo> para medir
 * FLUXO — quantas vagas NOVAS por semana por segmento —, que é a medição que
 * está faltando desde o começo do projeto.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { ALERTAS, alertasPendentes, alertasProntos, type Alerta } from '../src/config/alertas.ts';
import { buscarFeed } from '../src/alerts/feed.ts';
import { normalizarFeed } from '../src/alerts/normalizar.ts';
import { dedupPorHash, separarNovos } from '../src/dedupe.ts';
import { log } from '../src/logger.ts';
import type { ResultadoNormalizado } from '../src/normalize/resultado.ts';

interface Args {
  comparar: string | null;
  saida: string;
}

function lerArgs(argv: string[]): Args {
  const args: Args = {
    comparar: null,
    saida: `alertas-${new Date().toISOString().slice(0, 10)}.json`,
  };
  for (const bruto of argv) {
    if (bruto.startsWith('--comparar=')) args.comparar = bruto.slice('--comparar='.length);
    else if (bruto.startsWith('--saida=')) args.saida = bruto.slice('--saida='.length);
    else throw new Error(`argumento desconhecido: ${bruto}`);
  }
  return args;
}

function hashesDoArquivo(caminho: string): Set<string> {
  const dados: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
  const lista = (dados as { hashes?: string[] }).hashes ?? [];
  return new Set(lista);
}

function tabela(titulo: string, linhas: Array<[string, string | number]>): void {
  console.log(`\n${titulo}`);
  const largura = Math.max(...linhas.map(([r]) => r.length));
  for (const [rotulo, valor] of linhas) {
    console.log(`  ${rotulo.padEnd(largura)}  ${valor}`);
  }
}

async function main(): Promise<number> {
  const args = lerArgs(process.argv.slice(2));

  const pendentes = alertasPendentes();
  if (pendentes.length > 0) {
    console.log('\nAlertas ainda sem feedUrl — crie em google.com/alerts e cole a URL do RSS');
    console.log('em src/config/alertas.ts:\n');
    for (const a of pendentes) {
      console.log(`  [${a.id}]`);
      console.log(`     ${a.consulta}\n`);
    }
  }

  const prontos = alertasProntos();
  if (prontos.length === 0) {
    log.error('nenhum alerta com feedUrl preenchido: nada a medir');
    return 1;
  }

  const todos: ResultadoNormalizado[] = [];
  const porAlerta = new Map<string, { entradas: number; normalizados: number; descartados: number }>();

  for (const alerta of prontos) {
    try {
      const entradas = await buscarFeed(alerta.feedUrl as string);
      const { normalizados, descartados } = normalizarFeed(entradas, alerta);
      todos.push(...normalizados);
      porAlerta.set(alerta.id, {
        entradas: entradas.length,
        normalizados: normalizados.length,
        descartados,
      });
      log.info('feed lido', { alerta: alerta.id, entradas: entradas.length });
    } catch (erro) {
      log.error('feed falhou', { alerta: alerta.id, erro: String(erro) });
      porAlerta.set(alerta.id, { entradas: -1, normalizados: 0, descartados: 0 });
    }
  }

  const { unicos, duplicados } = dedupPorHash(todos);

  // --- o que o feed entregou -----------------------------------------------

  tabela(
    'POR ALERTA (entradas no feed / aproveitadas / descartadas)',
    prontos.map((a): [string, string] => {
      const d = porAlerta.get(a.id);
      if (!d || d.entradas < 0) return [a.id, 'FALHOU'];
      return [a.id, `${d.entradas} / ${d.normalizados} / ${d.descartados}`];
    }),
  );

  const porFonte = new Map<string, number>();
  for (const r of unicos) porFonte.set(r.fonte, (porFonte.get(r.fonte) ?? 0) + 1);

  tabela(
    'POR FONTE (depois da dedup)',
    [...porFonte.entries()].map(([f, n]): [string, number] => [f, n]),
  );

  const comData = unicos.filter((r) => r.dataIndexacao !== null).length;
  tabela('TOTAIS', [
    ['entradas brutas', todos.length],
    ['únicas (dedup por URL canônica)', unicos.length],
    ['duplicadas entre alertas', duplicados.length],
    ['com data de detecção', `${comData} de ${unicos.length}`],
  ]);

  // --- fluxo: só existe na segunda rodada ----------------------------------

  if (args.comparar) {
    const antes = hashesDoArquivo(args.comparar);
    const { novos, jaConhecidos } = separarNovos(unicos, antes);
    const porSegmento = new Map<string, number>();
    for (const r of novos) porSegmento.set(r.comboId, (porSegmento.get(r.comboId) ?? 0) + 1);

    tabela('FLUXO desde a medição anterior', [
      ['baseline', `${antes.size} URLs`],
      ['novas', novos.length],
      ['repetidas', jaConhecidos.length],
    ]);
    tabela(
      'NOVAS POR SEGMENTO',
      prontos.map((a): [string, number] => [a.id, porSegmento.get(a.id) ?? 0]),
    );
    console.log(
      `\n  Leitura: um feed que só ganha poucas vagas por semana por segmento esvazia` +
        `\n  no dia 2 e não sustenta retorno no dia 7. É esse número que decide.`,
    );
  } else {
    console.log(
      `\n  Esta é a linha de base. Rode de novo em 7 dias com` +
        `\n    node scripts/medir-alertas.ts --comparar=${args.saida}` +
        `\n  para obter o fluxo semanal — o dado que falta no projeto.`,
    );
  }

  writeFileSync(
    args.saida,
    JSON.stringify(
      {
        medidoEm: new Date().toISOString(),
        hashes: unicos.map((u) => u.urlHash),
        amostra: unicos.slice(0, 40).map((u) => ({
          alerta: u.comboId,
          fonte: u.fonte,
          titulo: u.titulo,
          url: u.urlCanonica,
          detectadoEm: u.dataIndexacao,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nbaseline salva em ${args.saida}`);

  // --- precisão continua sendo trabalho humano -----------------------------

  console.log(`\nAmostra para conferir precisão a olho (as 10 primeiras):`);
  for (const r of unicos.slice(0, 10)) {
    console.log(`  [${r.fonte}] ${r.titulo.slice(0, 66)}`);
    console.log(`     ${r.urlCanonica}`);
  }
  console.log(
    `\n  Conte quantas dessas são vaga de verdade do cargo buscado.` +
      `\n  No Passo 1 a precisão medida foi ~90-100%. Abaixo disso, o Alerts é pior` +
      `\n  que a PSE era e a consulta precisa de ajuste.`,
  );

  return 0;
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((erro: unknown) => {
    log.error('medição abortada', { erro: erro instanceof Error ? erro.message : String(erro) });
    process.exitCode = 1;
  });
