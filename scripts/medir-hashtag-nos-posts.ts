/**
 * A hipótese do `#vagas`, medida no post e não no índice do Google.
 *
 * OBSERVAÇÃO DO PEDRO (24/08): todo post de vaga carrega `#vagas`, e quase
 * sempre uma hashtag do cargo.
 *
 * O experimento anterior (`testar-posts-hashtag.ts`) testou isso pela SERP e
 * deu ruim — mas testava duas coisas ao mesmo tempo: se recrutador usa `#vagas`
 * E se o Google indexa a hashtag de forma pesquisável. Um resultado ruim ali
 * não distingue "a premissa é falsa" de "o índice não expõe a hashtag".
 *
 * Este script separa as duas. Ele abre o post e lê a hashtag no corpo, sem
 * passar pelo índice. Custo: zero crédito de Serper — só requisições HTTP.
 *
 * SOBRE LER A PÁGINA DO LINKEDIN. O CLAUDE.md proíbe scraping AUTENTICADO:
 * DOM logado, automação de sessão, endpoint interno — porque arrisca banir a
 * conta do Pedro. Aqui é GET anônimo em página pública, sem cookie e sem
 * sessão, uma vez por post, com intervalo. Não há conta envolvida para
 * arriscar. Ainda assim é acesso automatizado: manter volume baixo e não
 * transformar isso em coleta de produção sem decidir a questão de propósito.
 *
 * O QUE ISTO NÃO É. Não é medida de precisão do classificador: continua sem
 * gabarito. É medida de UMA premissa factual — a hashtag está lá ou não está.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { classificar } from '../src/classificar/classificador.ts';
import { cadeiaDoAmbiente } from '../src/classificar/llm.ts';
import type { Candidato } from '../src/classificar/tipos.ts';
import { carregarConfigClassificador } from '../src/config/env.ts';
import { log } from '../src/logger.ts';

const INTERVALO_MS = 1_500;
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ItemColetado {
  cargo: string;
  recorte: string;
  titulo: string;
  url: string;
  snippet: string;
  urlHash: string;
  jaNoBanco: boolean;
}

/**
 * Âncoras de navegação do próprio HTML (`href="#main"`), não hashtags do texto.
 * Sem esta limpeza, todo post "tem hashtag" e a medição não vale nada.
 */
const ANCORAS = new Set([
  'main',
  'content',
  'top',
  'footer',
  'header',
  'skip',
  'nav',
  'search',
  'close',
  'modal',
  'root',
  'app',
]);

const HASHTAG = /#([\p{L}\p{N}_]{2,40})/gu;

/** Hashtags do texto do post. Descarta âncora de HTML e fragmento de URL. */
export function hashtagsDaPagina(html: string): string[] {
  // Remove href="#..." antes de procurar: é lá que moram as âncoras.
  const semAncoras = html.replace(/href\s*=\s*["']#[^"']*["']/gi, ' ');

  const achadas = new Set<string>();
  for (const m of semAncoras.matchAll(HASHTAG)) {
    const tag = m[1];
    if (!tag) continue;
    const minuscula = tag.toLowerCase();
    if (ANCORAS.has(minuscula)) continue;
    // Hashtag puramente numérica costuma ser id de elemento.
    if (/^\d+$/.test(minuscula)) continue;
    achadas.add(minuscula);
  }
  return [...achadas];
}

const EH_VAGAS = /^vagas?$/;

async function baixar(url: string): Promise<{ ok: boolean; html: string; status: number }> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; wagas-medicao/1.0)',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    // Authwall devolve 200 com página de login: conteúdo vazio disfarçado de sucesso.
    const bloqueado = /authwall|sign in to see|faça login para ver/i.test(html.slice(0, 5_000));
    return { ok: res.ok && !bloqueado, html, status: res.status };
  } catch {
    return { ok: false, html: '', status: 0 };
  }
}

function pct(n: number, de: number): string {
  return de === 0 ? '-' : `${Math.round((100 * n) / de)}%`;
}

async function main(): Promise<number> {
  const arquivo = process.argv[2] ?? 'posts-sem-intitle-2026-08-24.json';
  const bruto = JSON.parse(readFileSync(arquivo, 'utf8')) as { coletados: ItemColetado[] };
  const itens = bruto.coletados;

  const config = carregarConfigClassificador({ precisaDb: false });
  const provedor = cadeiaDoAmbiente(config);
  if (!provedor) throw new Error('sem chave de LLM: preciso do veredito para cruzar com a hashtag');

  const candidatos: Candidato[] = itens.map((i) => ({
    id: null,
    fonte: 'linkedin_post',
    fonteId: null,
    urlCanonica: i.url,
    titulo: i.titulo,
    snippet: i.snippet,
    cargoBusca: i.cargo,
    localizacaoBusca: i.recorte === 'cidade' ? 'São Paulo' : null,
    dataPublicacao: null,
  }));

  log.info('classificando o bruto salvo (sem gastar crédito de Serper)', { itens: itens.length });
  const decisoes = await classificar(candidatos, provedor, {
    tamanhoDoLote: config.tamanhoDoLote,
    confiancaMinima: config.confiancaMinima,
  });

  log.info('abrindo os posts', { itens: itens.length, intervaloMs: INTERVALO_MS });

  const linhas: Array<{
    cargo: string;
    titulo: string;
    url: string;
    veredito: string;
    baixou: boolean;
    temVagas: boolean;
    hashtags: string[];
  }> = [];

  for (const [i, item] of itens.entries()) {
    if (i > 0) await dormir(INTERVALO_MS);
    const { ok, html } = await baixar(item.url);
    const hashtags = ok ? hashtagsDaPagina(html) : [];
    linhas.push({
      cargo: item.cargo,
      titulo: item.titulo,
      url: item.url,
      veredito: decisoes[i]?.veredito ?? 'sem-decisao',
      baixou: ok,
      temVagas: hashtags.some((t) => EH_VAGAS.test(t)),
      hashtags,
    });
    if ((i + 1) % 25 === 0) log.info('progresso', { lidos: i + 1, de: itens.length });
  }

  const baixados = linhas.filter((l) => l.baixou);
  const aprovados = baixados.filter((l) => l.veredito === 'aprovado');
  const reprovados = baixados.filter((l) => l.veredito === 'rejeitado');

  const comVagas = (lista: typeof linhas) => lista.filter((l) => l.temVagas).length;
  const comAlguma = (lista: typeof linhas) => lista.filter((l) => l.hashtags.length > 0).length;

  console.log('\nA HIPÓTESE DO `#vagas`, LIDA NO POST');
  console.log(`arquivo: ${arquivo}`);
  console.log(`posts: ${itens.length} | abertos com sucesso: ${baixados.length}`);
  console.log('');
  console.log('grupo'.padEnd(24) + 'posts'.padStart(7) + 'com #vagas'.padStart(13) + 'com alguma tag'.padStart(17));
  console.log('-'.repeat(61));
  for (const [nome, lista] of [
    ['todos', baixados],
    ['aprovados pelo LLM', aprovados],
    ['reprovados pelo LLM', reprovados],
  ] as const) {
    console.log(
      nome.padEnd(24) +
        String(lista.length).padStart(7) +
        `${comVagas(lista)} (${pct(comVagas(lista), lista.length)})`.padStart(13) +
        `${comAlguma(lista)} (${pct(comAlguma(lista), lista.length)})`.padStart(17),
    );
  }

  // As mais frequentes entre os aprovados: é a lista que viraria dork, se virar.
  const freq = new Map<string, number>();
  for (const l of aprovados) for (const t of l.hashtags) freq.set(t, (freq.get(t) ?? 0) + 1);
  console.log('\nhashtags mais comuns nos aprovados:');
  for (const [t, n] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(n).padStart(3)}  #${t}`);
  }

  const saida = `hashtags-nos-posts-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(saida, JSON.stringify({ medidoEm: new Date().toISOString(), origem: arquivo, linhas }, null, 2), 'utf8');
  console.log(`\nbruto em ${saida}`);
  return 0;
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((erro: unknown) => {
    log.error('medição abortada', { erro: erro instanceof Error ? erro.message : String(erro) });
    if (erro instanceof Error && erro.stack) console.error(erro.stack);
    process.exitCode = 1;
  });
