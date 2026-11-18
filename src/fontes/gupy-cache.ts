/**
 * Grava no cache o que a API da Gupy devolveu.
 *
 * A regra crítica do CLAUDE.md continua valendo do jeito que ela foi escrita: a
 * coleta popula o cache, o usuário lê o cache. O que mudou é QUEM dispara a
 * coleta e QUANTO ela custa. O motivo econômico da regra — "traduzir filtro de
 * usuário em consulta à API multiplicaria o custo pela combinatória" — não se
 * aplica a uma fonte sem chave e sem cobrança. O que se aplica é a educação com
 * a fonte, e disso cuida `coletas_sob_demanda`, que impede dez usuários pedindo
 * o mesmo par de virarem dez varreduras.
 *
 * As linhas entram nas DUAS tabelas, como as da SERP:
 *
 *   raw_results   já carimbada como aprovada no estágio `prefiltro`. Não é
 *                 atalho: as três perguntas do classificador foram respondidas
 *                 antes de chegar aqui — é vaga por construção (anúncio de
 *                 ATS), o cargo passou por `cargoBateNoTitulo`, e o local saiu
 *                 de campo estruturado. Nada foi decidido no escuro, e o motivo
 *                 fica gravado para o harness poder auditar esta fonte junto
 *                 com as outras.
 *   jobs          com as colunas de filtro do feed já preenchidas.
 */
import { SupabaseRest } from '../db/supabase.ts';
import { canonicalizarUrl, hashUrl } from '../normalize/url.ts';
import { normalizarCargo } from '../dedupe.ts';
import { classesDeFamilia, senioridadeDoTitulo, tokensDeFamilia } from '../classificar/familia.ts';
import { normalizarLocal, slugCidade, type LocalNormalizado } from '../normalize/local.ts';
import { log } from '../logger.ts';
import type { VagaDaGupy } from './gupy.ts';

export const CLASSIFICADOR = 'gupy-api/v1';

/**
 * O que muda de uma fonte estruturada para outra. Todo o resto — dedup, família,
 * local por campo, as duas tabelas — é o mesmo, e precisa continuar sendo: duas
 * gravações divergentes produzem feed que filtra diferente por fonte.
 */
export interface FonteDoCache {
  fonte: 'ats_gupy' | 'portal_infojobs' | 'ats_greenhouse';
  origemData: 'gupy_api' | 'metatag' | 'greenhouse_api';
  classificador: string;
  /** Prefixo de `raw_results.combo_id`, para medir cada rota separada. */
  comboPrefixo: string;
  /** Valor de `coletas_sob_demanda.fonte`. */
  coleta: string;
}

export const GUPY: FonteDoCache = {
  fonte: 'ats_gupy',
  origemData: 'gupy_api',
  classificador: CLASSIFICADOR,
  comboPrefixo: 'gupy-api',
  coleta: 'gupy_api',
};

export const INFOJOBS: FonteDoCache = {
  fonte: 'portal_infojobs',
  // JSON-LD `JobPosting` da página da vaga: é o que 'metatag' descreve desde a 0001.
  origemData: 'metatag',
  classificador: 'infojobs-jsonld/v1',
  comboPrefixo: 'infojobs',
  coleta: 'infojobs',
};

export const GREENHOUSE: FonteDoCache = {
  fonte: 'ats_greenhouse',
  origemData: 'greenhouse_api',
  classificador: 'greenhouse-api/v1',
  comboPrefixo: 'greenhouse',
  coleta: 'greenhouse',
};

export interface ResultadoDaGravacao {
  recebidas: number;
  novas: number;
  jaNoBanco: number;
  vagasGravadas: number;
}

interface LinhaPronta {
  urlHash: string;
  urlCanonica: string;
  vaga: VagaDaGupy;
}

/** Descarta o que não canonicaliza e colapsa repetição dentro do próprio lote. */
function prepararLote(vagas: VagaDaGupy[]): LinhaPronta[] {
  const vistos = new Set<string>();
  const prontas: LinhaPronta[] = [];

  for (const vaga of vagas) {
    const canonica = canonicalizarUrl(vaga.url);
    if (!canonica) continue;
    const urlHash = hashUrl(canonica.url);
    if (vistos.has(urlHash)) continue;
    vistos.add(urlHash);
    prontas.push({ urlHash, urlCanonica: canonica.url, vaga });
  }

  return prontas;
}

function linhaRaw(
  linha: LinhaPronta,
  cargoBusca: string,
  cidadeBusca: string | null,
  soRemoto: boolean,
  origem: FonteDoCache,
): Record<string, unknown> {
  const { vaga } = linha;
  return {
    url_hash: linha.urlHash,
    url_canonica: linha.urlCanonica,
    url_original: vaga.url,
    titulo: vaga.cargo,
    snippet: vaga.descricao,
    fonte: origem.fonte,
    fonte_id: vaga.fonteId,
    // Prefixo diferente do combo da SERP de propósito: é o que permite medir as
    // rotas separadamente em `raw_results` depois.
    combo_id: `${origem.comboPrefixo}:${soRemoto ? 'remoto' : 'cidade'}`,
    cargo_busca: cargoBusca,
    modelo_busca: soRemoto ? 'remoto' : 'qualquer',
    localizacao_busca: cidadeBusca,
    data_publicacao: vaga.dataPublicacao,
    data_publicacao_origem: vaga.origemData ?? origem.origemData,
    processado: true,
    classificacao: 'aprovado',
    classificacao_motivo: null,
    classificacao_estagio: 'prefiltro',
    classificado_em: new Date().toISOString(),
    classificador: origem.classificador,
    payload: vaga.bruto,
  };
}

/**
 * Uma linha de `jobs` por local. Gupy e InfoJobs têm um local só, e a linha sai
 * como sempre saiu. O Greenhouse anuncia a mesma vaga em várias cidades
 * ("BH; Curitiba; Recife; SP"), e cada cidade precisa da sua linha: o filtro de
 * cidade do feed é igualdade em `cidade_slug`.
 */
function linhasJob(linha: LinhaPronta, rawId: number | null, origem: FonteDoCache): Record<string, unknown>[] {
  const { vaga } = linha;
  if (!vaga.locais || vaga.locais.length === 0) return [linhaJob(linha, rawId, origem, normalizarLocal(vaga.localizacao), '')];
  const varias = vaga.locais.length > 1;
  return vaga.locais.map((l) => linhaJob(linha, rawId, origem, l, varias ? `@${l.cidadeSlug ?? ''}` : '', l.localizacao));
}

function linhaJob(
  linha: LinhaPronta,
  rawId: number | null,
  origem: FonteDoCache,
  local: LocalNormalizado,
  sufixoDedup: string,
  localizacao: string | null = linha.vaga.localizacao,
): Record<string, unknown> {
  const { vaga } = linha;

  return {
    raw_result_id: rawId,
    // O id da vaga NA FONTE, não empresa + cargo. A chave por empresa + cargo
    // descartava 65% das vagas aprovadas (medido em 23/10): a mesma rede com
    // "Vendedor(a) de Loja" em BH e em SP virava uma linha só, e quem buscava
    // em BH perdia a vaga. Vaga repetida ENTRE fontes é problema da exibição
    // (trava 5, `src/feed/colapsar.ts`), não da gravação.
    dedup_key: `${origem.fonte}:${vaga.fonteId}${sufixoDedup}`,
    dedup_por_empresa: false,
    empresa: vaga.empresa,
    cargo: vaga.cargo,
    cargo_normalizado: normalizarCargo(vaga.cargo),
    familia_tokens: tokensDeFamilia(vaga.cargo),
    familia_classes: classesDeFamilia(vaga.cargo),
    senioridade: senioridadeDoTitulo(vaga.cargo),
    modelo: vaga.modelo,
    localizacao,
    cidade_slug: local.cidadeSlug,
    uf: local.uf,
    pais_br: local.paisBr,
    // Julgado por campo estruturado, não por modelo de linguagem — ver o
    // comentário da coluna na migration 0006.
    local_avaliado: true,
    url: linha.urlCanonica,
    fonte: origem.fonte,
    descricao: vaga.descricao,
    data_publicacao: vaga.dataPublicacao,
    data_publicacao_origem: vaga.origemData ?? origem.origemData,
    // Sempre presente, null quando a fonte não informa. O insert em lote do
    // PostgREST exige as MESMAS chaves em todos os objetos (PGRST102): com a
    // chave condicional, um lote do InfoJobs com contrato em umas vagas e não
    // em outras derrubava a coleta diária inteira (13 a 15/11).
    tipo_contrato: vaga.tipoContrato ?? null,
    // Explícito, ainda que igual ao default: nesta rota "agora" é mesmo a hora
    // da coleta, e deixar implícito esconderia a diferença para a rota da SERP,
    // onde o default estava errado.
    data_coleta: new Date().toISOString(),
    classificado_em: new Date().toISOString(),
    classificador: origem.classificador,
    // Sem confiança: não houve estimativa. `null` é honesto, 1.0 seria inventar
    // uma probabilidade que ninguém calculou (achado 12).
    confianca: null,
  };
}

export async function gravarDaGupy(
  db: SupabaseRest,
  vagas: VagaDaGupy[],
  contexto: { cargoBusca: string; cidadeBusca: string | null; soRemoto: boolean },
  origem: FonteDoCache = GUPY,
): Promise<ResultadoDaGravacao> {
  const prontas = prepararLote(vagas);
  if (prontas.length === 0) {
    return { recebidas: vagas.length, novas: 0, jaNoBanco: 0, vagasGravadas: 0 };
  }

  const existentes = await origensExistentes(db, prontas.map((p) => p.urlHash));
  const novas = prontas.filter((p) => !existentes.has(p.urlHash));
  // Já está em `raw_results` mas não virou linha de `jobs`: é o que a chave por
  // empresa + cargo descartou antes de 23/10. Completar aqui faz a próxima
  // coleta recuperar essas vagas sem apagar nada.
  const orfas = prontas.filter((p) => existentes.get(p.urlHash)?.temVaga === false);

  if (novas.length === 0 && orfas.length === 0) {
    return { recebidas: vagas.length, novas: 0, jaNoBanco: prontas.length, vagasGravadas: 0 };
  }

  // `raw_results` primeiro, e com retorno, para a linha de `jobs` poder apontar
  // para a origem. Mesma ordem do classificador: a vaga entra antes de a origem
  // ser dada por resolvida.
  const gravadasRaw = novas.length
    ? await db.insert<{ id: number; url_hash: string }>(
        'raw_results',
        novas.map((n) => linhaRaw(n, contexto.cargoBusca, contexto.cidadeBusca, contexto.soRemoto, origem)),
        { ignorarDuplicados: true, conflito: 'url_hash', retornar: true },
      )
    : [];

  const idPorHash = new Map(gravadasRaw.map((g) => [g.url_hash, g.id]));
  for (const o of orfas) idPorHash.set(o.urlHash, existentes.get(o.urlHash)!.id);

  const gravadasJobs = await db.insert<{ id: number }>(
    'jobs',
    [...novas, ...orfas].flatMap((n) => linhasJob(n, idPorHash.get(n.urlHash) ?? null, origem)),
    { ignorarDuplicados: true, conflito: 'dedup_key', retornar: true },
  );

  log.info('fonte gravada no cache', {
    fonte: origem.fonte,
    recebidas: vagas.length,
    novas: novas.length,
    jaNoBanco: prontas.length - novas.length,
    vagasGravadas: gravadasJobs.length,
  });

  return {
    recebidas: vagas.length,
    novas: novas.length,
    jaNoBanco: prontas.length - novas.length,
    vagasGravadas: gravadasJobs.length,
  };
}

/**
 * Para cada hash já em `raw_results`: o id, e se ele já tem linha em `jobs`.
 * Em lotes, porque `in.(…)` vai na URL.
 */
async function origensExistentes(
  db: SupabaseRest,
  hashes: string[],
  tamanhoLote = 100,
): Promise<Map<string, { id: number; temVaga: boolean }>> {
  const saida = new Map<string, { id: number; temVaga: boolean }>();
  for (let i = 0; i < hashes.length; i += tamanhoLote) {
    const lote = hashes.slice(i, i + tamanhoLote).map((h) => `"${h}"`).join(',');
    const raws = await db.select<{ id: number; url_hash: string }>('raw_results', `select=id,url_hash&url_hash=in.(${lote})`);
    if (raws.length === 0) continue;
    const comVaga = new Set(
      (await db.select<{ raw_result_id: number }>('jobs', `select=raw_result_id&raw_result_id=in.(${raws.map((r) => r.id).join(',')})`))
        .map((j) => j.raw_result_id),
    );
    for (const r of raws) saida.set(r.url_hash, { id: r.id, temVaga: comVaga.has(r.id) });
  }
  return saida;
}

/** O nome honesto agora que a gravação serve a mais de uma fonte. */
export const gravarNoCache = gravarDaGupy;

/** Chave de frescor. Normaliza o cargo para "Enfermeiro" e "enfermeiro " serem a mesma coleta. */
export function chaveDeColeta(cargo: string, cidade: string | null) {
  return {
    cargo_chave: normalizarCargo(cargo),
    cidade_slug: cidade ? slugCidade(cidade) : '',
  };
}

interface EstadoDaColeta {
  ultima_coleta: string;
}

/** Quando este par foi buscado pela última vez, ou null se nunca. */
export async function ultimaColeta(
  db: SupabaseRest,
  cargo: string,
  cidade: string | null,
  soRemoto: boolean,
  origem: FonteDoCache = GUPY,
): Promise<Date | null> {
  const chave = chaveDeColeta(cargo, cidade);
  const linhas = await db.select<EstadoDaColeta>(
    'coletas_sob_demanda',
    `select=ultima_coleta&cargo_chave=eq.${encodeURIComponent(chave.cargo_chave)}` +
      `&cidade_slug=eq.${encodeURIComponent(chave.cidade_slug)}` +
      `&so_remoto=is.${soRemoto}&fonte=eq.${origem.coleta}&limit=1`,
  );
  const bruta = linhas[0]?.ultima_coleta;
  return bruta ? new Date(bruta) : null;
}

/** Carimba a coleta. O upsert soma execuções para dar a frequência por par. */
export async function registrarColeta(
  db: SupabaseRest,
  cargo: string,
  cidade: string | null,
  soRemoto: boolean,
  vistos: number,
  gravados: number,
  origem: FonteDoCache = GUPY,
): Promise<void> {
  const chave = chaveDeColeta(cargo, cidade);
  const anterior = await db.select<{ execucoes: number }>(
    'coletas_sob_demanda',
    `select=execucoes&cargo_chave=eq.${encodeURIComponent(chave.cargo_chave)}` +
      `&cidade_slug=eq.${encodeURIComponent(chave.cidade_slug)}` +
      `&so_remoto=is.${soRemoto}&fonte=eq.${origem.coleta}&limit=1`,
  );

  await db.insert(
    'coletas_sob_demanda',
    [
      {
        ...chave,
        so_remoto: soRemoto,
        fonte: origem.coleta,
        ultima_coleta: new Date().toISOString(),
        itens_vistos: vistos,
        itens_gravados: gravados,
        execucoes: (anterior[0]?.execucoes ?? 0) + 1,
      },
    ],
    { mesclarDuplicados: true, conflito: 'cargo_chave,cidade_slug,so_remoto,fonte' },
  );
}

/**
 * Ids do InfoJobs já em `jobs` e ainda na janela (com um dia de folga). A coleta
 * não abre de novo a página dessas vagas: com coleta diária, quase tudo o que a
 * listagem mostra foi lido na véspera. Só `jobs`, não `raw_results`: vaga que
 * ficou em `raw_results` sem linha em `jobs` precisa ser relida para a
 * autocura da gravação (achado 40) ter o que gravar.
 */
export async function idsConhecidosDoInfojobs(db: SupabaseRest, agora = new Date()): Promise<Set<string>> {
  const desde = new Date(agora.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const prefixo = `${INFOJOBS.fonte}:`;
  const linhas = await db.selectTodos<{ dedup_key: string }>(
    'jobs',
    `select=dedup_key&dedup_key=like.${encodeURIComponent(prefixo)}*&data_referencia=gte.${desde}&order=id`,
  );
  return new Set(linhas.map((l) => l.dedup_key.slice(prefixo.length)));
}
