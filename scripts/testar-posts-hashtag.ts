/**
 * Hashtag como filtro do bloco de posts.
 *
 * OBSERVAÇÃO DO PEDRO (24/08), olhando posts na mão: todo post de vaga carrega
 * `#vagas`, e quase sempre uma hashtag do cargo — `#productdesign`, `#uxdesign`.
 * Se for verdade, é um sinal de INTENÇÃO DO AUTOR, e não de vocabulário: quem
 * escreve `#vagas` está anunciando vaga. Muito mais forte que a palavra "vaga"
 * aparecer em algum lugar do texto.
 *
 * Isso importa porque o bloco de posts está espremido entre dois extremos ruins:
 * com `intitle:` traz 19 itens (precisão alta, recall péssimo); sem `intitle:`
 * traz 137, dos quais o classificador reprova 66%. A hashtag seria um terceiro
 * ponto: filtrar por intenção em vez de por posição do termo na página.
 *
 * A DÚVIDA QUE VEM ANTES. O Google historicamente IGNORA `#` e busca a palavra
 * solta. Se for esse o caso aqui, `"#vagas"` é só `"vagas"` e a ideia inteira
 * desaba — não por estar errada, mas por não ser expressável na SERP. Por isso
 * a primeira coisa que este script faz é uma SONDA: roda o mesmo dork com
 * `"#vagas"` e com `"vagas"` e compara as URLs devolvidas. Conjuntos iguais
 * significam `#` ignorado.
 *
 * LIMITE QUE JÁ SE SABE. Cargo -> hashtag não é mecânico: "Analista de Dados"
 * vira `#analistadedados`? `#dados`? `#analisededados`? Para três cargos dá
 * para escolher à mão; para cargo arbitrário digitado pelo usuário, não. É a
 * mesma objeção que tirou o Google Alerts de fonte principal. Se o experimento
 * der certo, isso vira o problema seguinte, não um detalhe.
 *
 * Nada é gravado em `raw_results`. O bruto vai para disco antes de classificar.
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
import { SupabaseQuotaStore } from '../src/quota/store.ts';
import { SerperCliente, SerperCreditosError } from '../src/serper/cliente.ts';
import { normalizarPaginaSerper } from '../src/serper/normalizar.ts';
import type { Combinacao } from '../src/tipos.ts';

const CHAVE_SALDO = 'serper';

const arquivoDoDia = () => `posts-hashtag-${new Date().toISOString().slice(0, 10)}.json`;
const CIDADE = 'São Paulo';
const TERMO_REMOTO = '("remoto" OR "home office" OR "100% remoto")';

type Recorte = 'cidade' | 'remoto';

/**
 * Hashtag do cargo, escolhida à mão. Três cargos de propósito: o objetivo é
 * saber se o mecanismo funciona, não cobrir o catálogo.
 */
const CARGOS: Array<{ cargo: string; tag: string }> = [
  { cargo: 'Product Designer', tag: '#productdesign' },
  { cargo: 'Desenvolvedor Front-end', tag: '#frontend' },
  { cargo: 'Analista de Marketing', tag: '#marketing' },
];

type Variante = 'tag-vagas' | 'tag-cargo';

function local(recorte: Recorte): string {
  return recorte === 'cidade' ? `"${CIDADE}"` : TERMO_REMOTO;
}

function dork(variante: Variante, cargo: string, tag: string, recorte: Recorte): string {
  if (variante === 'tag-vagas') {
    // Mantém o cargo entre aspas, troca o gatilho de intenção por `#vagas`.
    return `site:linkedin.com/posts "#vagas" "${cargo.toLowerCase()}" ${local(recorte)}`;
  }
  // Só hashtags: nem o cargo por extenso aparece.
  return `site:linkedin.com/posts "#vagas" "${tag}" ${local(recorte)}`;
}

interface ItemColetado {
  variante: Variante;
  cargo: string;
  recorte: Recorte;
  titulo: string;
  url: string;
  snippet: string;
  urlHash: string;
  jaNoBanco: boolean;
}

function combo(variante: Variante, cargo: string, recorte: Recorte, q: string): Combinacao {
  return {
    id: `exp-${variante}-${recorte}`,
    cargo,
    modelo: recorte === 'remoto' ? 'remoto' : 'qualquer',
    localizacao: recorte === 'cidade' ? CIDADE : null,
    fonte: 'linkedin_post',
    dork: q,
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
  de: string | null;
  soSonda: boolean;
}

function lerArgumentos(argv: string[]): Argumentos {
  const args: Argumentos = { dryRun: false, de: null, soSonda: false };
  for (const bruto of argv) {
    if (bruto === '--dry-run') args.dryRun = true;
    else if (bruto === '--so-sonda') args.soSonda = true;
    else if (bruto.startsWith('--de=')) args.de = bruto.slice('--de='.length);
    else throw new Error(`argumento desconhecido: ${bruto}`);
  }
  return args;
}

/**
 * O Google honra o `#`?
 *
 * Dois dorks idênticos, um com `"#vagas"` e outro com `"vagas"`. Se as URLs
 * devolvidas forem as mesmas, o `#` está sendo descartado antes da busca e
 * nenhuma estratégia baseada em hashtag é expressável nesta fonte.
 */
async function sondar(cliente: SerperCliente): Promise<{ honra: boolean; detalhe: string }> {
  // Sem cargo e sem local: os dois lados precisam devolver página cheia, senão
  // a comparação é entre dois conjuntos de tamanho 1 e não significa nada — foi
  // o que aconteceu na primeira tentativa desta sonda.
  const comTag = await cliente.buscar('site:linkedin.com/posts "#vagas"', { pagina: 1, tbs: JANELA });
  const semTag = await cliente.buscar('site:linkedin.com/posts "vagas"', { pagina: 1, tbs: JANELA });

  const a = new Set(comTag.organicos.map((o) => o.link ?? ''));
  const b = new Set(semTag.organicos.map((o) => o.link ?? ''));
  const intersecao = [...a].filter((x) => b.has(x)).length;
  const uniao = new Set([...a, ...b]).size;
  const jaccard = uniao === 0 ? 0 : intersecao / uniao;

  // Amostra pequena não decide nada: com poucos resultados de cada lado, tanto
  // 0% quanto 100% de sobreposição são ruído.
  const conclusiva = a.size >= 5 && b.size >= 5;

  return {
    honra: !conclusiva || jaccard < 0.9,
    detalhe:
      `"#vagas" devolveu ${a.size}, "vagas" devolveu ${b.size}, sobreposição ${(jaccard * 100).toFixed(0)}%` +
      (conclusiva ? '' : ' — AMOSTRA PEQUENA DEMAIS PARA CONCLUIR'),
  };
}

async function coletar(): Promise<{ itens: ItemColetado[]; creditos: number; sonda: string }> {
  const config = carregarConfig({ precisaDb: true, precisaFonte: true });
  const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);
  const store = new SupabaseQuotaStore(db);

  const variantes: Variante[] = ['tag-vagas', 'tag-cargo'];
  const custo = 2 + CARGOS.length * variantes.length * 2; // sonda + cargos x variantes x recortes
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

  const brutos: ItemColetado[] = [];
  let sonda = 'não executada';

  try {
    const resultado = await sondar(cliente);
    sonda = resultado.detalhe;
    log.info('sonda do `#`', { honra: resultado.honra, detalhe: resultado.detalhe });
    if (!resultado.honra) {
      log.error('o Google ignorou o `#`: a estratégia de hashtag não é expressável nesta fonte');
      return { itens: [], creditos: cliente.consumidos, sonda };
    }

    for (const { cargo, tag } of CARGOS) {
      for (const variante of variantes) {
        for (const recorte of ['cidade', 'remoto'] as const) {
          const q = dork(variante, cargo, tag, recorte);
          try {
            const { organicos } = await cliente.buscar(q, { pagina: 1, tbs: JANELA });
            const { normalizados } = normalizarPaginaSerper(organicos, {
              combo: combo(variante, cargo, recorte, q),
              pagina: 1,
            });
            for (const item of normalizados) {
              brutos.push({
                variante,
                cargo,
                recorte,
                titulo: item.titulo,
                url: item.urlCanonica,
                snippet: item.snippet,
                urlHash: item.urlHash,
                jaNoBanco: false,
              });
            }
            log.info('consulta concluída', { cargo, variante, recorte, itens: organicos.length });
          } catch (erro) {
            if (erro instanceof SerperCreditosError) throw erro;
            log.error('consulta falhou', { cargo, variante, recorte, erro: String(erro) });
          }
        }
      }
    }
  } finally {
    const sobra = reservados - cliente.consumidos;
    if (sobra > 0) await store.devolver(CHAVE_SALDO, sobra);
  }

  // Dedup por (variante, cargo): o mesmo post aparece nos dois recortes.
  const vistos = new Set<string>();
  const unicos = brutos.filter((b) => {
    const chave = `${b.variante}|${b.cargo}|${b.urlHash}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  // "Já no banco" aqui significa: o dork de produção, COM `intitle:`, já trazia.
  const conhecidos = await hashesExistentes(
    db,
    unicos.map((u) => u.urlHash),
  );
  for (const u of unicos) u.jaNoBanco = conhecidos.has(u.urlHash);

  // Persistir AQUI, não no chamador. Crédito gasto e não salvo é crédito
  // perdido: já aconteceu duas vezes neste projeto, uma por queda do LLM e
  // outra por uma flag que retornava antes do writeFileSync.
  writeFileSync(arquivoDoDia(), JSON.stringify({ sonda, coletados: unicos }, null, 2), 'utf8');
  log.info('bruto salvo', { arquivo: arquivoDoDia(), itens: unicos.length, creditos: cliente.consumidos });

  return { itens: unicos, creditos: cliente.consumidos, sonda };
}

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
  sonda: string,
  arquivo: string,
): Promise<number> {
  if (itens.length === 0) {
    console.log('\nnenhum item coletado — ver a sonda acima');
    return 1;
  }

  const decisoes = await classificarComRetentativa(itens.map(paraCandidato), configLlm);

  const chave = (i: ItemColetado) => `${i.variante}|${i.cargo}`;
  const grupos = new Map<string, Array<{ item: ItemColetado; decisao: Decisao }>>();
  itens.forEach((item, i) => {
    const decisao = decisoes[i];
    if (!decisao) return;
    const k = chave(item);
    const lista = grupos.get(k);
    if (lista) lista.push({ item, decisao });
    else grupos.set(k, [{ item, decisao }]);
  });

  const linhas: Array<Record<string, string | number>> = [];
  const aprovados: Array<{ variante: string; cargo: string; titulo: string; url: string }> = [];

  for (const [k, lista] of [...grupos].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const resumo = resumir(lista.map((l) => l.decisao));
    for (const { item, decisao } of lista) {
      if (decisao.veredito === 'aprovado') {
        aprovados.push({ variante: item.variante, cargo: item.cargo, titulo: item.titulo, url: item.url });
      }
    }
    linhas.push({
      grupo: k,
      coletados: lista.length,
      jaNoBanco: lista.filter((l) => l.item.jaNoBanco).length,
      aprovados: resumo.aprovados,
      corteLlm: resumo.rejeitadosNoLlm,
      erros: resumo.erros,
      precisao: lista.length > 0 ? Math.round((100 * resumo.aprovados) / lista.length) : 0,
    });
  }

  const COLUNAS = ['coletados', 'jaNoBanco', 'aprovados', 'corteLlm', 'erros', 'precisao'];
  const cab = 'variante | cargo'.padEnd(44) + COLUNAS.map((c) => c.padStart(12)).join('');
  console.log(`\nHASHTAG COMO FILTRO — São Paulo, 1 página, janela de 7 dias`);
  console.log(`sonda do \`#\`: ${sonda}`);
  console.log(cab);
  console.log('-'.repeat(cab.length));
  for (const l of linhas) {
    console.log(String(l['grupo']).padEnd(44) + COLUNAS.map((c) => String(l[c]).padStart(12)).join(''));
  }
  console.log('-'.repeat(cab.length));
  console.log(
    'TOTAL'.padEnd(44) +
      COLUNAS.slice(0, 5)
        .map((c) => String(linhas.reduce((s, l) => s + Number(l[c]), 0)).padStart(12))
        .join(''),
  );

  console.log(`\nAPROVADOS (${aprovados.length})`);
  for (const a of aprovados) console.log(`  [${a.variante}/${a.cargo}] ${a.titulo}\n      ${a.url}`);

  writeFileSync(
    arquivo,
    JSON.stringify(
      { medidoEm: new Date().toISOString(), cidade: CIDADE, janela: JANELA, sonda, creditosConsumidos: creditos, porGrupo: linhas, aprovados, coletados: itens },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nbruto e relatório em ${arquivo}`);
  return 0;
}

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2));

  if (args.dryRun) {
    console.log('SONDA (2 créditos):');
    console.log(`  site:linkedin.com/posts "#vagas" "product designer" ${local('cidade')}`);
    console.log(`  site:linkedin.com/posts "product designer" ${local('cidade')} "vagas"`);
    console.log('\nVARIANTES (12 créditos):');
    for (const { cargo, tag } of CARGOS) {
      for (const v of ['tag-vagas', 'tag-cargo'] as const) {
        for (const r of ['cidade', 'remoto'] as const) {
          console.log(`  [${v}/${cargo}/${r}]\n      ${dork(v, cargo, tag, r)}`);
        }
      }
    }
    log.info('dry-run: nenhum crédito consumido', { custoSeRodasse: 14 });
    return 0;
  }

  const configLlm = carregarConfigClassificador({ precisaDb: true });

  if (args.de) {
    const bruto = JSON.parse(readFileSync(args.de, 'utf8')) as { coletados: ItemColetado[]; sonda?: string };
    return relatar(bruto.coletados, configLlm, 0, bruto.sonda ?? '-', args.de);
  }

  const { itens, creditos, sonda } = await coletar();
  if (args.soSonda) {
    log.info('só a sonda foi pedida', { sonda, creditos });
    return 0;
  }

  return relatar(itens, configLlm, creditos, sonda, arquivoDoDia());
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
