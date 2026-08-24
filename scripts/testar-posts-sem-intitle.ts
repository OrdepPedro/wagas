/**
 * O `intitle:` do dork de post ainda vale a pena?
 *
 * HISTÓRICO. O Passo 1 mediu o bloco de posts com ~25% de precisão e o
 * consertou acrescentando `intitle:"<cargo>"`, que exige o cargo no título da
 * página. A precisão foi para ~100%. Na época era a única saída: não existia
 * classificador, então tudo que o dork trouxesse ia direto para o feed.
 *
 * O QUE MUDOU. Agora existe classificador com precisão medida. A troca de
 * recall por precisão foi feita num mundo sem segunda linha de defesa; hoje há.
 *
 * O QUE O `intitle:` CUSTA HOJE. Coleta de 24/08, São Paulo, 2 páginas: o bloco
 * de posts trouxe 19 itens em 248 — 7,7% do acervo. É a menor fonte de todas, e
 * é justamente a que sustenta o diferencial declarado do produto.
 *
 * DESENHO. Só o braço SEM `intitle:` é coletado. O controle já está no banco,
 * coletado na mesma semana com as mesmas 2 páginas — recoletá-lo seria gastar
 * 20 créditos para reproduzir número que já existe.
 *
 * Nada é gravado em `raw_results`. Misturar dork experimental lá estragaria o
 * significado de `combo_id` e contaminaria as métricas de produção.
 *
 * O BRUTO VAI PARA DISCO ANTES DE CLASSIFICAR. A primeira execução perdeu 64%
 * dos itens numa rajada de 503 do Gemini e, sem o bruto salvo, a única saída
 * foi recoletar — 20 créditos que não voltam. Agora `--de=<arquivo>`
 * reclassifica de graça quantas vezes for preciso.
 *
 * O QUE ESTE SCRIPT NÃO MEDE. Precisão. Ele mede quanto o CLASSIFICADOR aprova,
 * que não é a mesma coisa: tomar a aprovação do classificador como prova de que
 * o classificador acertou é circular. O que ele entrega é o número que decide se
 * vale rotular — se o volume extra for quase todo reprovado, a resposta já está
 * dada e ninguém precisa rotular nada.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { classificar, resumir } from '../src/classificar/classificador.ts';
import { cadeiaDoAmbiente } from '../src/classificar/llm.ts';
import type { Candidato, Decisao } from '../src/classificar/tipos.ts';
import { JANELA } from '../src/config/alvos.ts';
import {
  carregarConfig,
  carregarConfigClassificador,
  type ConfigClassificador,
} from '../src/config/env.ts';
import { hashesExistentes, SupabaseRest } from '../src/db/supabase.ts';
import { log } from '../src/logger.ts';
import type { ResultadoNormalizado } from '../src/normalize/resultado.ts';
import { SupabaseQuotaStore } from '../src/quota/store.ts';
import { SerperCliente, SerperCreditosError } from '../src/serper/cliente.ts';
import { normalizarPaginaSerper } from '../src/serper/normalizar.ts';
import type { Combinacao } from '../src/tipos.ts';

const CHAVE_SALDO = 'serper';
const CIDADE = 'São Paulo';

/** Os mesmos cinco coletados em 24/08 com `intitle:`, para o controle bater. */
const CARGOS = [
  'Product Designer',
  'Desenvolvedor Front-end',
  'Analista de Dados',
  'Analista de Marketing',
  'Auxiliar Administrativo',
];

const TERMO_REMOTO = '("remoto" OR "home office" OR "100% remoto")';
const RUIDO_POSTS = '-curso -mentoria -programa';

type Recorte = 'cidade' | 'remoto';

/** Um item coletado, salvo em disco para poder reclassificar sem recoletar. */
interface ItemColetado {
  cargo: string;
  recorte: Recorte;
  titulo: string;
  url: string;
  snippet: string;
  urlHash: string;
  /** O braço COM `intitle:` já tinha trazido este item? */
  jaNoBanco: boolean;
}

/**
 * O dork de post SEM `intitle:` — o mesmo da medição de 23/08, letra por letra.
 * Reescrevê-lo "melhor" inventaria uma terceira variante, e a comparação
 * deixaria de medir o `intitle:` isolado.
 */
function dorkSemIntitle(cargo: string, recorte: Recorte): string {
  const local = recorte === 'cidade' ? `"${CIDADE}"` : TERMO_REMOTO;
  return `site:linkedin.com/posts "${cargo.toLowerCase()}" ("contratando" OR "vaga" OR "hiring") ${local} ${RUIDO_POSTS}`;
}

function combo(cargo: string, recorte: Recorte, dork: string): Combinacao {
  return {
    id: `exp-sem-intitle-${recorte}`,
    cargo,
    modelo: recorte === 'remoto' ? 'remoto' : 'qualquer',
    localizacao: recorte === 'cidade' ? CIDADE : null,
    fonte: 'linkedin_post',
    dork,
    dateRestrict: 'd7',
    paginas: 1,
    ativo: true,
  };
}

function paraCandidato(item: ItemColetado): Candidato {
  return {
    id: null,
    fonte: 'linkedin_post',
    fonteId: null,
    urlCanonica: item.url,
    titulo: item.titulo,
    snippet: item.snippet,
    cargoBusca: item.cargo,
    localizacaoBusca: item.recorte === 'cidade' ? CIDADE : null,
    dataPublicacao: null,
  };
}

interface Argumentos {
  dryRun: boolean;
  paginas: number;
  /** Reclassifica um bruto já salvo, sem gastar crédito. */
  de: string | null;
}

function lerArgumentos(argv: string[]): Argumentos {
  const args: Argumentos = { dryRun: false, paginas: 2, de: null };
  for (const bruto of argv) {
    if (bruto === '--dry-run') args.dryRun = true;
    else if (bruto.startsWith('--de=')) args.de = bruto.slice('--de='.length);
    else if (bruto.startsWith('--paginas=')) {
      const n = Number(bruto.slice('--paginas='.length));
      if (!Number.isFinite(n) || n < 1 || n > 10) throw new Error('--paginas fora de 1..10');
      args.paginas = Math.floor(n);
    } else throw new Error(`argumento desconhecido: ${bruto}`);
  }
  return args;
}

// ---------------------------------------------------------------------------
// coleta
// ---------------------------------------------------------------------------

async function coletar(paginas: number): Promise<{ itens: ItemColetado[]; creditos: number }> {
  const config = carregarConfig({ precisaDb: true, precisaFonte: true });
  const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);
  const store = new SupabaseQuotaStore(db);

  const custo = CARGOS.length * 2 * paginas;
  const reservados = await store.reservar(CHAVE_SALDO, custo, config.creditosTotais);
  if (reservados < custo) {
    if (reservados > 0) await store.devolver(CHAVE_SALDO, reservados);
    throw new Error(`saldo insuficiente: precisava de ${custo}, consegui ${reservados}`);
  }

  const cliente = new SerperCliente({
    key: config.serperKey,
    orcamento: reservados,
    intervaloMs: config.intervaloMs,
    tentativas: config.tentativas,
  });

  const brutos: Array<{ item: ResultadoNormalizado; cargo: string; recorte: Recorte }> = [];
  const dorksEsgotados = new Set<string>();

  try {
    for (const cargo of CARGOS) {
      for (const recorte of ['cidade', 'remoto'] as const) {
        const dork = dorkSemIntitle(cargo, recorte);
        for (let pagina = 1; pagina <= paginas; pagina++) {
          if (cliente.restante <= 0 || dorksEsgotados.has(dork)) continue;
          try {
            const { organicos } = await cliente.buscar(dork, { pagina, tbs: JANELA });
            if (organicos.length === 0) {
              dorksEsgotados.add(dork);
              continue;
            }
            const { normalizados } = normalizarPaginaSerper(organicos, {
              combo: combo(cargo, recorte, dork),
              pagina,
            });
            for (const item of normalizados) brutos.push({ item, cargo, recorte });
          } catch (erro) {
            if (erro instanceof SerperCreditosError) throw erro;
            log.error('consulta falhou', { cargo, recorte, pagina, erro: String(erro) });
          }
        }
      }
      log.info('cargo coletado', { cargo, acumulado: brutos.length });
    }
  } finally {
    const sobra = reservados - cliente.consumidos;
    if (sobra > 0) await store.devolver(CHAVE_SALDO, sobra);
  }

  // Dedup dentro do cargo: o mesmo post aparece nos dois recortes.
  const vistosPorCargo = new Map<string, Set<string>>();
  const unicos: typeof brutos = [];
  for (const b of brutos) {
    let vistos = vistosPorCargo.get(b.cargo);
    if (!vistos) {
      vistos = new Set<string>();
      vistosPorCargo.set(b.cargo, vistos);
    }
    if (vistos.has(b.item.urlHash)) continue;
    vistos.add(b.item.urlHash);
    unicos.push(b);
  }

  // Quanto disso o braço COM `intitle:` já tinha trazido? O banco responde: o
  // controle foi coletado na mesma semana e está lá.
  const conhecidos = await hashesExistentes(
    db,
    unicos.map((u) => u.item.urlHash),
  );

  return {
    creditos: cliente.consumidos,
    itens: unicos.map(({ item, cargo, recorte }) => ({
      cargo,
      recorte,
      titulo: item.titulo,
      url: item.urlCanonica,
      snippet: item.snippet,
      urlHash: item.urlHash,
      jaNoBanco: conhecidos.has(item.urlHash),
    })),
  };
}

// ---------------------------------------------------------------------------
// classificação e relatório
// ---------------------------------------------------------------------------

/**
 * Classifica e repete UMA vez o que deu erro.
 *
 * Erro aqui é 503 ou rede, não veredito. Em produção o item fica pendente e
 * volta na rodada seguinte; num experimento que não grava, quem não repetir
 * perde o dado — foi assim que a primeira execução deste script se invalidou,
 * com 64% dos itens sem classificação.
 */
async function classificarComRetentativa(
  candidatos: Candidato[],
  configLlm: ConfigClassificador,
): Promise<Decisao[]> {
  const provedor = cadeiaDoAmbiente(configLlm);
  if (!provedor) throw new Error('sem chave de LLM: o experimento não mede aprovação');

  const opcoes = {
    tamanhoDoLote: configLlm.tamanhoDoLote,
    confiancaMinima: configLlm.confiancaMinima,
  };

  const decisoes = await classificar(candidatos, provedor, opcoes);

  const comErro = decisoes.flatMap((d, i) => (d.veredito === 'erro' ? [i] : []));
  if (comErro.length === 0) return decisoes;

  log.warn('repetindo o que deu erro', { itens: comErro.length });
  const repetidas = await classificar(
    comErro.map((i) => candidatos[i]!),
    provedor,
    opcoes,
  );
  comErro.forEach((indice, k) => {
    const nova = repetidas[k];
    if (nova) decisoes[indice] = nova;
  });

  return decisoes;
}

async function relatar(
  itens: ItemColetado[],
  configLlm: ConfigClassificador,
  creditos: number,
  arquivo: string,
): Promise<number> {
  const decisoes = await classificarComRetentativa(itens.map(paraCandidato), configLlm);

  const porCargo = new Map<string, Array<{ item: ItemColetado; decisao: Decisao }>>();
  itens.forEach((item, i) => {
    const decisao = decisoes[i];
    if (!decisao) return;
    const lista = porCargo.get(item.cargo);
    if (lista) lista.push({ item, decisao });
    else porCargo.set(item.cargo, [{ item, decisao }]);
  });

  const linhas: Array<Record<string, number | string>> = [];
  const ganhos: Array<{ cargo: string; titulo: string; url: string; confianca: number | null }> = [];

  for (const cargo of CARGOS) {
    const doCargo = porCargo.get(cargo) ?? [];
    const resumo = resumir(doCargo.map((d) => d.decisao));

    let ganhoLiquido = 0;
    for (const { item, decisao } of doCargo) {
      if (decisao.veredito !== 'aprovado' || item.jaNoBanco) continue;
      ganhoLiquido++;
      ganhos.push({ cargo, titulo: item.titulo, url: item.url, confianca: decisao.confianca });
    }

    linhas.push({
      cargo,
      coletados: doCargo.length,
      jaNoBanco: doCargo.filter((d) => d.item.jaNoBanco).length,
      aprovados: resumo.aprovados,
      ganhoLiquido,
      cortePrefiltro: resumo.rejeitadosNoPrefiltro,
      corteLlm: resumo.rejeitadosNoLlm,
      erros: resumo.erros,
    });
  }

  const COLUNAS = [
    'coletados',
    'jaNoBanco',
    'aprovados',
    'ganhoLiquido',
    'cortePrefiltro',
    'corteLlm',
    'erros',
  ];
  const cabecalho = 'cargo'.padEnd(26) + COLUNAS.map((c) => c.padStart(15)).join('');

  console.log('\nBLOCO DE POSTS SEM `intitle:` — São Paulo, janela de 7 dias');
  console.log(cabecalho);
  console.log('-'.repeat(cabecalho.length));
  for (const l of linhas) {
    console.log(String(l['cargo']).padEnd(26) + COLUNAS.map((c) => String(l[c]).padStart(15)).join(''));
  }
  console.log('-'.repeat(cabecalho.length));
  console.log(
    'TOTAL'.padEnd(26) +
      COLUNAS.map((c) => String(linhas.reduce((s, l) => s + Number(l[c]), 0)).padStart(15)).join(''),
  );

  const comErro = linhas.reduce((s, l) => s + Number(l['erros']), 0);
  if (comErro > 0) {
    console.log(
      `\n[!] ${comErro} itens ficaram sem classificação mesmo depois da retentativa.` +
        `\n    A medição está INCOMPLETA. Rode 'node scripts/testar-posts-sem-intitle.ts --de=${arquivo}'` +
        `\n    para reclassificar sem gastar crédito.`,
    );
  }

  console.log(`\nAPROVADOS QUE O \`intitle:\` NÃO TRAZIA (${ganhos.length})`);
  console.log('Ler um a um: é isto que decide se o ganho é vaga ou ruído bem-comportado.');
  for (const g of ganhos) {
    console.log(`  [${g.cargo}] (conf ${g.confianca ?? '-'}) ${g.titulo}\n      ${g.url}`);
  }

  writeFileSync(
    arquivo,
    JSON.stringify(
      {
        medidoEm: new Date().toISOString(),
        cidade: CIDADE,
        janela: JANELA,
        creditosConsumidos: creditos,
        provedor: cadeiaDoAmbiente(configLlm)?.nome ?? null,
        porCargo: linhas,
        ganhos,
        // O bruto fica junto: reclassificar com --de não custa crédito nenhum.
        coletados: itens,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nbruto e relatório em ${arquivo}`);

  return comErro > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2));

  if (args.dryRun) {
    for (const cargo of CARGOS) {
      for (const recorte of ['cidade', 'remoto'] as const) {
        console.log(`[${cargo}/${recorte}]\n    ${dorkSemIntitle(cargo, recorte)}`);
      }
    }
    log.info('dry-run: nenhum crédito consumido', {
      custoSeRodasse: CARGOS.length * 2 * args.paginas,
    });
    return 0;
  }

  const configLlm = carregarConfigClassificador({ precisaDb: true });

  if (args.de) {
    const bruto = JSON.parse(readFileSync(args.de, 'utf8')) as { coletados: ItemColetado[] };
    log.info('reclassificando do bruto salvo, sem gastar crédito', {
      arquivo: args.de,
      itens: bruto.coletados.length,
    });
    return relatar(bruto.coletados, configLlm, 0, args.de);
  }

  const { itens, creditos } = await coletar(args.paginas);
  const arquivo = `posts-sem-intitle-${new Date().toISOString().slice(0, 10)}.json`;

  // O bruto vai para disco ANTES de classificar: se o LLM cair no meio, o
  // crédito já gasto não se perde junto.
  writeFileSync(arquivo, JSON.stringify({ coletados: itens }, null, 2), 'utf8');
  log.info('bruto salvo antes de classificar', { arquivo, itens: itens.length, creditos });

  return relatar(itens, configLlm, creditos, arquivo);
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((erro: unknown) => {
    log.error('experimento abortado', { erro: erro instanceof Error ? erro.message : String(erro) });
    if (erro instanceof Error && erro.stack) console.error(erro.stack);
    process.exitCode = 1;
  });
