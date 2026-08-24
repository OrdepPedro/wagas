/**
 * Reproduz o Passo 1 pela Serper e compara com o que foi medido à mão.
 *
 * A pergunta: a Serper devolve o mesmo acervo que a PSE devolvia, com a mesma
 * precisão? Referência do Passo 1: ~46 vagas únicas e relevantes, precisão
 * ~90-100% nos dorks de vaga formal e ~100% no de post.
 *
 * Custo: 5 dorks x 2 páginas = 10 créditos dos 2.500 gratuitos (0,4%).
 * O contador é ACUMULADO em .quota/serper.json — os créditos gratuitos não
 * renovam, então o que importa é quanto já se gastou do total, não do dia.
 */
import { writeFileSync } from 'node:fs';

import { COMBINACOES } from '../src/config/searches.ts';
import { dedupPorHash } from '../src/dedupe.ts';
import { log } from '../src/logger.ts';
import type { ResultadoNormalizado } from '../src/normalize/resultado.ts';
import { ArquivoQuotaStore } from '../src/quota/store.ts';
import { SerperCliente, SerperCreditosError } from '../src/serper/cliente.ts';
import { normalizarPaginaSerper } from '../src/serper/normalizar.ts';

/** Os 5 dorks validados no Passo 1 — os mesmos ids dos alertas, para bater a comparação. */
const DORKS = [
  'pm-bh-job',
  'pm-remoto-job',
  'pm-bh-gupy',
  'pm-remoto-post-titulo',
  'pm-remoto-post-corpo',
] as const;

const CREDITOS_GRATUITOS = 2500;
const REFERENCIA_PASSO1 = 46;

interface Args {
  paginas: number;
  dryRun: boolean;
}

function lerArgs(argv: string[]): Args {
  const args: Args = { paginas: 2, dryRun: false };
  for (const bruto of argv) {
    if (bruto === '--dry-run') args.dryRun = true;
    else if (bruto.startsWith('--paginas=')) {
      const n = Number(bruto.slice('--paginas='.length));
      if (!Number.isFinite(n) || n < 1 || n > 5) throw new Error(`--paginas fora de 1..5`);
      args.paginas = Math.floor(n);
    } else throw new Error(`argumento desconhecido: ${bruto}`);
  }
  return args;
}

async function main(): Promise<number> {
  const args = lerArgs(process.argv.slice(2));

  const combos = DORKS.map((id) => {
    const c = COMBINACOES.find((x) => x.id === id);
    if (!c) throw new Error(`combo "${id}" sumiu do searches.ts`);
    return c;
  });

  const custo = combos.length * args.paginas;

  console.log(`\nReprodução do Passo 1 pela Serper`);
  console.log(`  dorks: ${combos.length} x ${args.paginas} página(s) = ${custo} créditos\n`);

  if (args.dryRun) {
    for (const c of combos) console.log(`  [${c.id}]\n     ${c.dork}`);
    console.log('\ndry-run: nada enviado, nenhum crédito gasto.');
    return 0;
  }

  const key = process.env['SERPER_KEY']?.trim();
  if (!key) {
    log.error('SERPER_KEY ausente — pegue em serper.dev e coloque no .env');
    return 1;
  }

  // Mesmo store da PSE, com chave 'serper' em vez de dia: os créditos gratuitos
  // são um saldo único, não uma cota que zera.
  const store = new ArquivoQuotaStore('.quota/serper.json');
  const concedidos = await store.reservar('serper', custo, CREDITOS_GRATUITOS);
  if (concedidos < custo) {
    log.error('créditos insuficientes no saldo local', { pedidos: custo, concedidos });
    await store.devolver('serper', concedidos);
    return 1;
  }

  const cliente = new SerperCliente({ key, orcamento: concedidos });
  const coletados: ResultadoNormalizado[] = [];
  const porDork = new Map<string, number>();

  try {
    for (const combo of combos) {
      let doDork = 0;
      for (let pagina = 1; pagina <= args.paginas; pagina++) {
        if (cliente.restante <= 0) break;
        try {
          const { organicos } = await cliente.buscar(combo.dork, { pagina });
          const { normalizados } = normalizarPaginaSerper(organicos, { combo, pagina });
          coletados.push(...normalizados);
          doDork += normalizados.length;
          log.info('página lida', {
            dork: combo.id,
            pagina,
            brutos: organicos.length,
            aproveitados: normalizados.length,
          });
        } catch (erro) {
          if (erro instanceof SerperCreditosError) throw erro;
          log.error('dork falhou', { dork: combo.id, pagina, erro: String(erro) });
        }
      }
      porDork.set(combo.id, doDork);
    }
  } finally {
    const sobra = concedidos - cliente.consumidos;
    if (sobra > 0) await store.devolver('serper', sobra);
  }

  const { unicos, duplicados } = dedupPorHash(coletados);
  const porFonte = new Map<string, number>();
  for (const r of unicos) porFonte.set(r.fonte, (porFonte.get(r.fonte) ?? 0) + 1);

  console.log(`\n${'═'.repeat(72)}`);
  console.log('RESULTADO');
  console.log(`${'═'.repeat(72)}`);
  for (const c of combos) console.log(`  ${c.id.padEnd(24)} ${porDork.get(c.id) ?? 0}`);
  console.log('');
  console.log(`  brutos ................ ${coletados.length}`);
  console.log(`  únicos após dedup ..... ${unicos.length}`);
  console.log(`  duplicados entre dorks  ${duplicados.length}`);
  console.log('');
  for (const [f, n] of porFonte) console.log(`  ${f.padEnd(22)} ${n}`);

  const razao = unicos.length / REFERENCIA_PASSO1;
  console.log(`\n  Passo 1 (manual, PSE): ${REFERENCIA_PASSO1} vagas únicas`);
  console.log(`  Serper agora ........: ${unicos.length}  (${(razao * 100).toFixed(0)}%)`);
  if (razao < 0.6) {
    console.log(`  ⚠ bem abaixo da referência — ou o acervo mudou, ou a fonte cobre menos.`);
  }

  const saldo = await store.estado('serper', CREDITOS_GRATUITOS);
  console.log(
    `\n  créditos: ${cliente.consumidos} nesta execução; ` +
      `${saldo.consumidas}/${CREDITOS_GRATUITOS} usados no total.`,
  );

  const arquivo = `serper-passo1-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(
    arquivo,
    JSON.stringify(
      {
        medidoEm: new Date().toISOString(),
        paginasPorDork: args.paginas,
        unicos: unicos.map((u) => ({
          dork: u.comboId,
          fonte: u.fonte,
          titulo: u.titulo,
          url: u.urlCanonica,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n  bruto salvo em ${arquivo}`);

  console.log(`\nAmostra para conferir precisão (conte quantas são vaga real do cargo):`);
  for (const r of unicos.slice(0, 15)) {
    console.log(`  [${r.fonte}] ${r.titulo.slice(0, 64)}`);
    console.log(`     ${r.urlCanonica}`);
  }

  return 0;
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((erro: unknown) => {
    log.error('comparação abortada', { erro: erro instanceof Error ? erro.message : String(erro) });
    process.exitCode = 1;
  });
