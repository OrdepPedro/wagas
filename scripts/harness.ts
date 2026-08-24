/**
 * Roda o harness sobre o golden set e imprime o relatório.
 *
 *   node --env-file-if-exists=.env scripts/harness.ts              # tudo que houver chave para rodar
 *   node --env-file-if-exists=.env scripts/harness.ts --so-prefiltro   # sem chave, sem custo
 *   node --env-file-if-exists=.env scripts/harness.ts --json=saida.json
 *
 * O pré-filtro roda SEMPRE, com ou sem chave. Ele é o teto de recall do produto
 * inteiro — o LLM não recupera o que ele já cortou —, então é o primeiro número
 * a olhar, e o único que não depende de cota de ninguém.
 *
 * Duas limitações do golden set atual, impressas no relatório de propósito para
 * não serem esquecidas na leitura:
 *
 *   1. NÃO HÁ SNIPPET. As medições de 22 e 23/08 guardaram só título e URL. Em
 *      `linkedin_post` o título vem reescrito pelo Google, então o modelo julga
 *      esses casos praticamente às cegas: o número do bloco de posts aqui é
 *      piso, não estimativa.
 *   2. LOCALIZAÇÃO NÃO É MEDIDA. O rótulo responde "é vaga e o cargo bate?".
 *      Se a vaga remota é do Brasil ou dos Estados Unidos continua sem medição.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { classificar } from '../src/classificar/classificador.ts';
import {
  avaliarDecisoes,
  avaliarPrefiltro,
  falhas,
  medir,
  medirPor,
  paraCandidato,
  type Avaliado,
  type CasoRotulado,
  type Metricas,
} from '../src/classificar/harness.ts';
import { cadeiaDoAmbiente } from '../src/classificar/llm.ts';
import { carregarConfigClassificador } from '../src/config/env.ts';
import { log } from '../src/logger.ts';

const PADRAO = 'harness/golden.jsonl';

interface Argumentos {
  arquivo: string;
  soPrefiltro: boolean;
  json: string | null;
  limite: number | null;
}

function lerArgumentos(argv: string[]): Argumentos {
  const args: Argumentos = { arquivo: PADRAO, soPrefiltro: false, json: null, limite: null };

  for (const bruto of argv) {
    if (bruto === '--so-prefiltro') args.soPrefiltro = true;
    else if (bruto.startsWith('--golden=')) args.arquivo = bruto.slice('--golden='.length);
    else if (bruto.startsWith('--json=')) args.json = bruto.slice('--json='.length);
    else if (bruto.startsWith('--limite=')) {
      const n = Number(bruto.slice('--limite='.length));
      if (!Number.isFinite(n) || n < 1) throw new Error(`--limite inválido: ${bruto}`);
      args.limite = Math.floor(n);
    } else throw new Error(`argumento desconhecido: ${bruto}`);
  }

  return args;
}

function lerGolden(arquivo: string): CasoRotulado[] {
  const linhas = readFileSync(arquivo, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//'));

  return linhas.map((linha, i) => {
    try {
      return JSON.parse(linha) as CasoRotulado;
    } catch {
      throw new Error(`${arquivo}:${i + 1} não é JSON válido`);
    }
  });
}

const pct = (v: number | null): string => (v === null ? '  n/d' : `${(v * 100).toFixed(0)}%`.padStart(5));

function linhaMetrica(nome: string, m: Metricas): string {
  const casos = m.positivosVerdadeiros + m.falsosPositivos + m.falsosNegativos + m.negativosVerdadeiros;
  return [
    nome.padEnd(26),
    pct(m.precisao),
    pct(m.recall),
    pct(m.f1),
    String(casos).padStart(6),
    String(m.falsosNegativos).padStart(4),
    String(m.falsosPositivos).padStart(4),
    String(m.indefinidos).padStart(5),
  ].join(' ');
}

const CABECALHO = [
  'estágio / recorte'.padEnd(26),
  'preci',
  'recal',
  '   f1',
  ' casos',
  '  FN',
  '  FP',
  ' ind.',
].join(' ');

function imprimirTabela(titulo: string, linhas: string[]): void {
  console.log(`\n${titulo}`);
  console.log(CABECALHO);
  console.log('-'.repeat(CABECALHO.length));
  for (const l of linhas) console.log(l);
}

function imprimirFalhas(avaliados: Avaliado[]): void {
  const { falsosNegativos, falsosPositivos } = falhas(avaliados);

  console.log(`\nFALSOS NEGATIVOS — vaga boa que o pipeline descartou (${falsosNegativos.length})`);
  if (falsosNegativos.length === 0) console.log('  nenhum');
  for (const a of falsosNegativos) {
    console.log(`  [${a.caso.fonte}] ${a.caso.titulo}`);
    console.log(`      cargo buscado: ${a.caso.cargoBusca} | caiu em ${a.motivo} (${a.estagio}): ${a.detalhe}`);
  }

  console.log(`\nFALSOS POSITIVOS — lixo que chegaria no feed (${falsosPositivos.length})`);
  if (falsosPositivos.length === 0) console.log('  nenhum');
  for (const a of falsosPositivos) {
    console.log(`  [${a.caso.fonte}] ${a.caso.titulo}`);
    console.log(`      cargo buscado: ${a.caso.cargoBusca} | ${a.caso.nota || a.caso.classe}`);
  }
}

function imprimirCobertura(casos: CasoRotulado[]): void {
  const indeterminados = casos.filter((c) => c.rotulo === 'indeterminado');
  const semSnippet = casos.filter((c) => c.snippet === '').length;
  const porFonte = new Map<string, number>();
  for (const c of indeterminados) porFonte.set(c.fonte, (porFonte.get(c.fonte) ?? 0) + 1);

  console.log('\nCOBERTURA DO GOLDEN SET');
  console.log(`  casos: ${casos.length}`);
  console.log(`  relevantes: ${casos.filter((c) => c.rotulo === 'relevante').length}`);
  console.log(`  irrelevantes: ${casos.filter((c) => c.rotulo === 'irrelevante').length}`);
  console.log(
    `  indeterminados (fora da métrica): ${indeterminados.length}` +
      (porFonte.size > 0 ? ` — ${[...porFonte].map(([f, n]) => `${f}: ${n}`).join(', ')}` : ''),
  );
  console.log(`  sem snippet: ${semSnippet} de ${casos.length}`);
}

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2));
  let casos = lerGolden(args.arquivo);
  if (args.limite !== null) casos = casos.slice(0, args.limite);

  imprimirCobertura(casos);

  // --- estágio 1: pré-filtro, de graça --------------------------------------
  const doPrefiltro = avaliarPrefiltro(casos);
  const metricasPrefiltro = medir(doPrefiltro);

  imprimirTabela('PRÉ-FILTRO ISOLADO — o recall aqui é o teto do produto inteiro', [
    linhaMetrica('geral', metricasPrefiltro),
    ...[...medirPor(doPrefiltro, (c) => c.fonte)].map(([k, m]) => linhaMetrica(`  fonte: ${k}`, m)),
    ...[...medirPor(doPrefiltro, (c) => c.cargoBusca)].map(([k, m]) => linhaMetrica(`  cargo: ${k}`, m)),
  ]);
  imprimirFalhas(doPrefiltro);

  // --- estágio 2: pipeline completo -----------------------------------------
  const config = carregarConfigClassificador({ precisaDb: false });
  const provedor = args.soPrefiltro ? null : cadeiaDoAmbiente(config);

  let doPipeline: Avaliado[] | null = null;

  if (!provedor) {
    console.log(
      args.soPrefiltro
        ? '\n(--so-prefiltro: o LLM não foi avaliado)'
        : '\n(sem GEMINI_KEY nem GROQ_KEY: o LLM não foi avaliado)',
    );
  } else {
    console.log(`\nclassificando ${casos.length} casos com ${provedor.nome}...`);
    const decisoes = await classificar(casos.map(paraCandidato), provedor, {
      tamanhoDoLote: config.tamanhoDoLote,
      confiancaMinima: config.confiancaMinima,
    });
    doPipeline = avaliarDecisoes(casos, decisoes);

    imprimirTabela(`PIPELINE COMPLETO — pré-filtro + ${provedor.nome}`, [
      linhaMetrica('geral', medir(doPipeline)),
      ...[...medirPor(doPipeline, (c) => c.fonte)].map(([k, m]) => linhaMetrica(`  fonte: ${k}`, m)),
      ...[...medirPor(doPipeline, (c) => c.cargoBusca)].map(([k, m]) =>
        linhaMetrica(`  cargo: ${k}`, m),
      ),
    ]);
    imprimirFalhas(doPipeline);
  }

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify(
        {
          medidoEm: new Date().toISOString(),
          golden: args.arquivo,
          casos: casos.length,
          prefiltro: { metricas: metricasPrefiltro, avaliados: doPrefiltro },
          pipeline: doPipeline
            ? { provedor: provedor?.nome, metricas: medir(doPipeline), avaliados: doPipeline }
            : null,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`\nrelatório salvo em ${args.json}`);
  }

  return 0;
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((erro: unknown) => {
    log.error('harness abortado', { erro: erro instanceof Error ? erro.message : String(erro) });
    if (erro instanceof Error && erro.stack) console.error(erro.stack);
    process.exitCode = 1;
  });
