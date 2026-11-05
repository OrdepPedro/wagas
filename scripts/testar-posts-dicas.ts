/**
 * As dicas de dork de um post de LinkedIn (30/10) melhoram o bloco de posts?
 *
 * O post sugere: procurar o MOVIMENTO de contratação ("estamos contratando",
 * "join our team", "growing our team", "aumentando o time"), ancorar o remoto
 * em "Brazil"/"LATAM", e usar `after:`. O `after:` fica de fora: o `tbs=qdr:w`
 * já faz o mesmo papel, e o Passo 1 mediu o `after:` como redundante. Sinais de
 * empresa sem vaga ("new office", "engineering team") também ficam de fora:
 * sem corpo de vaga não há currículo para adaptar.
 *
 * TRÊS BRAÇOS, coletados na MESMA execução. O controle não pode vir do banco
 * como no `testar-posts-sem-intitle.ts`: as linhas de post de agosto já saíram
 * da janela, e comparar semanas diferentes mediria a semana, não o dork.
 *
 *   producao   o dork de `alvos.ts`, letra por letra (controle)
 *   gatilhos   o mesmo, com os gatilhos do post somados no OR — só pode
 *              ampliar, então o que importa é o ganho sobre o controle
 *   remoto_en  remoto escrito em inglês e ancorado no Brasil. O recorte remoto
 *              de produção só tem termos em português; o achado 27 mostrou que
 *              o bloco traz muito post em inglês, quase todo de fora
 *
 * Os três mantêm `intitle:` (trava 8) e os negativos medidos. Nenhum termo novo
 * entra fora do que o post sugeriu — acrescentar termo invalida a comparação.
 *
 * Nada é gravado em `raw_results`. O bruto vai para disco ANTES de classificar,
 * e `--de=<arquivo>` reclassifica sem gastar crédito.
 *
 * O QUE NÃO MEDE: precisão. Aprovação do classificador não é acerto (achado
 * 15); o relatório lista o ganho um a um para rotular à mão.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { classificar, resumir } from '../src/classificar/classificador.ts';
import { cadeiaDoAmbiente } from '../src/classificar/llm.ts';
import type { Candidato, Decisao } from '../src/classificar/tipos.ts';
import { JANELA, montarDork } from '../src/config/alvos.ts';
import {
  carregarConfig,
  carregarConfigClassificador,
  type ConfigClassificador,
} from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { log } from '../src/logger.ts';
import { SupabaseQuotaStore } from '../src/quota/store.ts';
import { SerperCliente, SerperCreditosError } from '../src/serper/cliente.ts';
import { normalizarPaginaSerper } from '../src/serper/normalizar.ts';
import type { Combinacao } from '../src/tipos.ts';

const CHAVE_SALDO = 'serper';
const CIDADE = 'São Paulo';

/** Os cinco da medição de 24/08, para os números conversarem com o achado 15. */
const CARGOS = [
  'Product Designer',
  'Desenvolvedor Front-end',
  'Analista de Dados',
  'Analista de Marketing',
  'Auxiliar Administrativo',
];

const RUIDO_POSTS = '-curso -mentoria -programa';
const GATILHOS_POST =
  '("contratando" OR "vaga" OR "hiring" OR "join our team" OR "growing our team" OR "aumentando o time")';

type Braco = 'producao' | 'gatilhos' | 'remoto_en';
type Recorte = 'cidade' | 'remoto';

const RODADAS: Array<{ braco: Braco; recorte: Recorte }> = [
  { braco: 'producao', recorte: 'cidade' },
  { braco: 'producao', recorte: 'remoto' },
  { braco: 'gatilhos', recorte: 'cidade' },
  { braco: 'gatilhos', recorte: 'remoto' },
  { braco: 'remoto_en', recorte: 'remoto' },
];

function dork(braco: Braco, cargo: string, recorte: Recorte): string {
  if (braco === 'producao') return montarDork('linkedin_post', cargo, recorte, CIDADE);
  const titulo = `intitle:"${cargo.toLowerCase()}"`;
  if (braco === 'gatilhos') {
    const local = recorte === 'cidade' ? `"${CIDADE}"` : '("remoto" OR "home office" OR "100% remoto")';
    return `site:linkedin.com/posts ${titulo} ${GATILHOS_POST} ${local} ${RUIDO_POSTS}`;
  }
  return `site:linkedin.com/posts ${titulo} ("hiring" OR "join our team") "remote" ("Brazil" OR "LATAM") ${RUIDO_POSTS}`;
}

interface ItemColetado {
  braco: Braco;
  cargo: string;
  recorte: Recorte;
  titulo: string;
  url: string;
  snippet: string;
  urlHash: string;
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

function combo(item: { braco: Braco; cargo: string; recorte: Recorte }, d: string): Combinacao {
  return {
    id: `exp-dicas-${item.braco}-${item.recorte}`,
    cargo: item.cargo,
    modelo: item.recorte === 'remoto' ? 'remoto' : 'qualquer',
    localizacao: item.recorte === 'cidade' ? CIDADE : null,
    fonte: 'linkedin_post',
    dork: d,
    dateRestrict: 'd7',
    paginas: 1,
    ativo: true,
  };
}

interface Argumentos {
  dryRun: boolean;
  paginas: number;
  de: string | null;
}

function lerArgumentos(argv: string[]): Argumentos {
  const args: Argumentos = { dryRun: false, paginas: 1, de: null };
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

const custo = (paginas: number) => CARGOS.length * RODADAS.length * paginas;

async function coletar(paginas: number): Promise<{ itens: ItemColetado[]; creditos: number }> {
  const config = carregarConfig({ precisaDb: true, precisaFonte: true });
  const store = new SupabaseQuotaStore(new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey));

  const reservados = await store.reservar(CHAVE_SALDO, custo(paginas), config.creditosTotais);
  if (reservados < custo(paginas)) {
    if (reservados > 0) await store.devolver(CHAVE_SALDO, reservados);
    throw new Error(`saldo insuficiente: precisava de ${custo(paginas)}, consegui ${reservados}`);
  }

  const cliente = new SerperCliente({
    key: config.serperKey,
    orcamento: reservados,
    intervaloMs: config.intervaloMs,
    tentativas: config.tentativas,
  });

  const itens: ItemColetado[] = [];
  // Dedup dentro do braço e do cargo: o mesmo post aparece nos dois recortes.
  const vistos = new Set<string>();

  try {
    for (const cargo of CARGOS) {
      for (const { braco, recorte } of RODADAS) {
        const d = dork(braco, cargo, recorte);
        for (let pagina = 1; pagina <= paginas; pagina++) {
          if (cliente.restante <= 0) break;
          try {
            const { organicos } = await cliente.buscar(d, { pagina, tbs: JANELA });
            if (organicos.length === 0) break;
            const { normalizados } = normalizarPaginaSerper(organicos, {
              combo: combo({ braco, cargo, recorte }, d),
              pagina,
            });
            for (const n of normalizados) {
              const chave = `${braco}|${cargo}|${n.urlHash}`;
              if (vistos.has(chave)) continue;
              vistos.add(chave);
              itens.push({
                braco,
                cargo,
                recorte,
                titulo: n.titulo,
                url: n.urlCanonica,
                snippet: n.snippet,
                urlHash: n.urlHash,
              });
            }
          } catch (erro) {
            if (erro instanceof SerperCreditosError) throw erro;
            log.error('consulta falhou', { cargo, braco, recorte, pagina, erro: String(erro) });
          }
        }
      }
      log.info('cargo coletado', { cargo, acumulado: itens.length });
    }
  } finally {
    const sobra = reservados - cliente.consumidos;
    if (sobra > 0) await store.devolver(CHAVE_SALDO, sobra);
  }

  return { itens, creditos: cliente.consumidos };
}

/** Classifica e repete UMA vez o que deu erro — num experimento que não grava, erro é dado perdido. */
async function classificarComRetentativa(
  candidatos: Candidato[],
  configLlm: ConfigClassificador,
): Promise<Decisao[]> {
  const provedor = cadeiaDoAmbiente(configLlm);
  if (!provedor) throw new Error('sem chave de LLM: o experimento não mede aprovação');
  const opcoes = { tamanhoDoLote: configLlm.tamanhoDoLote, confiancaMinima: configLlm.confiancaMinima };

  const decisoes = await classificar(candidatos, provedor, opcoes);
  const comErro = decisoes.flatMap((d, i) => (d.veredito === 'erro' ? [i] : []));
  if (comErro.length === 0) return decisoes;

  log.warn('repetindo o que deu erro', { itens: comErro.length });
  const repetidas = await classificar(comErro.map((i) => candidatos[i]!), provedor, opcoes);
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
  const pares = itens.map((item, i) => ({ item, decisao: decisoes[i]! }));

  // Ganho = aprovado num braço experimental que o controle não trouxe, no mesmo cargo.
  const doControle = new Set(
    pares.filter((p) => p.item.braco === 'producao').map((p) => `${p.item.cargo}|${p.item.urlHash}`),
  );

  const COLUNAS = ['coletados', 'aprovados', 'ganho', 'localRuim', 'corteLlm', 'erros'];
  const cabecalho = 'braço'.padEnd(12) + COLUNAS.map((c) => c.padStart(12)).join('');
  console.log(`\nBLOCO DE POSTS — dicas do post vs. produção — ${CIDADE}, janela de 7 dias`);
  console.log(cabecalho);
  console.log('-'.repeat(cabecalho.length));

  const linhas: Array<Record<string, number | string>> = [];
  const ganhos: Array<{ braco: Braco; cargo: string; titulo: string; url: string }> = [];
  let erros = 0;

  for (const braco of ['producao', 'gatilhos', 'remoto_en'] as const) {
    const doBraco = pares.filter((p) => p.item.braco === braco);
    const resumo = resumir(doBraco.map((p) => p.decisao));
    const novos = doBraco.filter(
      (p) => braco !== 'producao' && p.decisao.veredito === 'aprovado' && !doControle.has(`${p.item.cargo}|${p.item.urlHash}`),
    );
    for (const p of novos) ganhos.push({ braco, cargo: p.item.cargo, titulo: p.item.titulo, url: p.item.url });
    erros += resumo.erros;

    const linha = {
      braco,
      coletados: resumo.total,
      aprovados: resumo.aprovados,
      ganho: novos.length,
      localRuim: resumo.porMotivo['local_nao_serve'] ?? 0,
      corteLlm: resumo.rejeitadosNoLlm,
      erros: resumo.erros,
    };
    linhas.push(linha);
    console.log(braco.padEnd(12) + COLUNAS.map((c) => String(linha[c as keyof typeof linha]).padStart(12)).join(''));
  }

  if (erros > 0) {
    console.log(
      `\n[!] ${erros} itens sem classificação depois da retentativa. Medição INCOMPLETA:` +
        `\n    node scripts/testar-posts-dicas.ts --de=${arquivo}`,
    );
  }

  console.log(`\nAPROVADOS QUE A PRODUÇÃO NÃO TRAZIA (${ganhos.length}) — rotular um a um`);
  for (const g of ganhos) console.log(`  [${g.braco}/${g.cargo}] ${g.titulo}\n      ${g.url}`);

  writeFileSync(
    arquivo,
    JSON.stringify(
      {
        medidoEm: new Date().toISOString(),
        cidade: CIDADE,
        janela: JANELA,
        creditosConsumidos: creditos,
        provedor: cadeiaDoAmbiente(configLlm)?.nome ?? null,
        porBraco: linhas,
        ganhos,
        coletados: itens,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nbruto e relatório em ${arquivo}`);
  return erros > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2));

  if (args.dryRun) {
    for (const cargo of CARGOS) {
      for (const { braco, recorte } of RODADAS) {
        console.log(`[${cargo}/${braco}/${recorte}]\n    ${dork(braco, cargo, recorte)}`);
      }
    }
    log.info('dry-run: nenhum crédito consumido', { custoSeRodasse: custo(args.paginas) });
    return 0;
  }

  const configLlm = carregarConfigClassificador({ precisaDb: true });

  if (args.de) {
    const bruto = JSON.parse(readFileSync(args.de, 'utf8')) as { coletados: ItemColetado[] };
    log.info('reclassificando do bruto salvo, sem gastar crédito', { arquivo: args.de, itens: bruto.coletados.length });
    return relatar(bruto.coletados, configLlm, 0, args.de);
  }

  const { itens, creditos } = await coletar(args.paginas);
  const arquivo = `posts-dicas-${new Date().toISOString().slice(0, 10)}.json`;
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
