/**
 * InfoJobs — portal público, lido pela página da vaga.
 *
 * Entrou em 20/10/2026, com a restrição 3 ampliada para portal brasileiro
 * público (achado 37). Medido antes de entrar, como a trava 10 exige: não é eco
 * da Gupy (1 vaga em comum em 486) e mais que dobra o não-tech em Auxiliar
 * Administrativo e Vendedor. Em tech não serve — PM tem 1 vaga por semana.
 *
 * Não há API. O caminho é:
 *
 *   listagem pública por cargo × cidade, ordenada por data
 *     → página de cada vaga
 *       → JSON-LD `JobPosting` (o que o InfoJobs publica para o Google)
 *
 * O `JobPosting` traz data com hora, empresa, cidade/UF estruturadas e a
 * descrição inteira — o que o currículo adaptado precisa.
 *
 * LIMITES:
 *
 *  - **Uma requisição por vaga, a uma por segundo.** Uma busca leva minutos.
 *    Por isso esta fonte roda SÓ na coleta (`scripts/coletar-infojobs.ts`),
 *    nunca no request do usuário — a mesma condição da trava 4.
 *  - **Scraping de HTML.** Quebra quando o layout mudar. Tudo degrada para
 *    lista vazia com `falhou: true`; fonte caída não é fonte vazia (achado 24).
 *  - **A busca do site é frouxa.** "Analista de dados" devolveu 123 e só 4 eram
 *    da família. `cargoBateNoTitulo` é o que torna esta fonte usável.
 *  - **A paginação engana em silêncio:** `Page` maiúsculo e no fim da URL;
 *    `page` minúsculo é ignorado e devolve sempre a página 1.
 */
import { cargoBateNoTitulo, semSenioridade } from '../classificar/familia.ts';
import { modeloDoTexto, normalizarLocal, slugCidade } from '../normalize/local.ts';
import { log } from '../logger.ts';
import type { VagaDaGupy } from './gupy.ts';

/** Mesmo formato da Gupy: as duas passam pela mesma gravação (`gupy-cache.ts`). */
export type VagaDoInfojobs = VagaDaGupy;

const BASE = 'https://www.infojobs.com.br';
const CABECALHOS = { 'user-agent': 'Mozilla/5.0', accept: 'text/html' } as const;

/**
 * Slug de busca. "Auxiliar Administrativo" + "São Paulo" + "SP" →
 * `/vagas-de-emprego-auxiliar+administrativo-em-sao-paulo,-sp.aspx`.
 * Sem cidade, busca o Brasil inteiro.
 *
 * **A UF não é opcional.** Sem ela o site não filtra cidade e falha em
 * silêncio de dois jeitos: `belo-horizonte` devolve o Brasil inteiro (16.256
 * vagas contra 779) e `sao-paulo` devolve o ESTADO (7.252 contra 3.252).
 * Medido em 20/10, depois de uma coleta ler 592 páginas para gravar 12.
 */
export function urlDeBusca(cargo: string, cidade: string | null, uf: string | null, pagina: number): string {
  if (cidade && !/^[a-z]{2}$/i.test(uf ?? '')) {
    throw new Error(`InfoJobs: cidade "${cidade}" sem UF — a busca viraria nacional ou estadual`);
  }
  const termo = cargo.trim().toLowerCase().replace(/\s+/g, '+');
  const local = cidade ? `-em-${slugCidade(cidade)},-${uf!.toLowerCase()}` : '';
  // `Page` maiúsculo e por último: com `page` o site devolve a página 1 sempre.
  return `${BASE}/vagas-de-emprego-${encodeURI(termo)}${local}.aspx?campo=griddate&orden=desc&Page=${pagina}`;
}

/** Links de vaga de uma página de listagem, na ordem em que aparecem, sem repetir. */
export function linksDaListagem(html: string): string[] {
  const vistos = new Set<string>();
  for (const m of html.matchAll(/href="(\/vaga-de-[^"]+__\d+\.aspx)"/g)) vistos.add(m[1]!);
  return [...vistos].map((caminho) => BASE + caminho);
}

/** O primeiro `JobPosting` em JSON-LD da página, ou null. */
export function jobPostingDaPagina(html: string): Record<string, any> | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let dado: unknown;
    try {
      dado = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const candidatos = Array.isArray(dado) ? dado : [dado, ...((dado as any)?.['@graph'] ?? [])];
    for (const c of candidatos) if (c?.['@type'] === 'JobPosting') return c;
  }
  return null;
}

/**
 * O InfoJobs escreve `2026-10-13T14:23:00.0000000`, sem fuso. É horário de
 * Brasília; ler como UTC adiantaria toda vaga em 3 horas, e ler como fuso da
 * máquina faria o resultado depender de onde o coletor roda.
 */
export function dataDoInfojobs(bruta: unknown): string | null {
  if (typeof bruta !== 'string' || bruta.trim() === '') return null;
  const texto = bruta.trim();
  const temFuso = /(Z|[+-]\d{2}:?\d{2})$/.test(texto);
  const ms = Date.parse(temFuso ? texto : texto.replace(/(\.\d{3})\d*$/, '$1') + '-03:00');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function semHtml(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  const limpo = texto
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
  return limpo || null;
}

/**
 * Converte o `JobPosting` de uma página. Null quando falta o mínimo — sem
 * título, sem data ou sem id na URL a vaga não é exibível nem deduplicável.
 */
export function normalizarJobPosting(jp: Record<string, any>, url: string): VagaDoInfojobs | null {
  const cargo = typeof jp.title === 'string' ? jp.title.trim() : '';
  const dataPublicacao = dataDoInfojobs(jp.datePosted);
  const fonteId = /__(\d+)\.aspx/i.exec(url)?.[1];
  if (!cargo || !dataPublicacao || !fonteId) return null;

  const endereco = jp.jobLocation?.address ?? (Array.isArray(jp.jobLocation) ? jp.jobLocation[0]?.address : null);
  const cidade = typeof endereco?.addressLocality === 'string' ? endereco.addressLocality.trim() : '';
  const uf = typeof endereco?.addressRegion === 'string' ? endereco.addressRegion.trim() : '';
  // Mesmo formato que a Gupy monta, e a mesma `normalizarLocal` decide: duas
  // normalizações fariam o filtro de cidade discordar entre fontes.
  const localizacao = [cidade, uf].filter(Boolean).join(' - ') || null;
  const local = normalizarLocal(localizacao);

  const descricao = semHtml(jp.description);
  // Só o texto DA vaga. O HTML da página também diz "Presencial", mas a página
  // tem lateral de outras vagas — é o achado 1 em outro site.
  const modelo =
    jp.jobLocationType === 'TELECOMMUTE' ? 'remoto' : modeloDoTexto(cargo, descricao);

  const empresa = typeof jp.hiringOrganization?.name === 'string' ? jp.hiringOrganization.name.trim() : '';

  return {
    fonteId,
    url,
    cargo,
    empresa: empresa || 'não identificada',
    localizacao,
    cidadeSlug: local.cidadeSlug,
    uf: local.uf,
    modelo,
    dataPublicacao,
    descricao,
    bruto: jp,
  };
}

// ---------------------------------------------------------------------------
// Bloco da vaga no HTML — só quando não há `JobPosting` (achado 39)
// ---------------------------------------------------------------------------

/**
 * O HTML da vaga até o início das "Outras vagas similares". Tudo depois disso
 * é a lateral com OUTRAS vagas — ler de lá é o achado 1 neste site. Sem o
 * marcador, não há como saber onde a vaga termina, e a página é recusada.
 */
export function blocoDaVaga(html: string): string | null {
  const corte = html.indexOf('id="divSimilarVacancies"');
  return corte > 0 ? html.slice(0, corte) : null;
}

function textoHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Efetivo – CLT - Período Integral", "Prestador de Serviços (PJ) - …". */
export function contratoDoBloco(bloco: string): string | null {
  const m = /Tipo de contrato e Jornada:\s*<\/span>([^<]+)</.exec(bloco);
  return m ? textoHtml(m[1]!) || null : null;
}

/**
 * Modelo pelo ícone do campo, não pelo texto: o mesmo `div` de estilo também
 * carrega o selo de vaga PCD, e ler "o primeiro ícone" pegou esse selo na
 * medição de 22/10.
 */
export function modeloDoBloco(bloco: string): 'remoto' | 'presencial' | 'hibrido' | null {
  if (/xlink:href="#user-home"/.test(bloco)) return 'remoto';
  if (/xlink:href="#[a-z-]*hibrid[a-z-]*"/.test(bloco) || />\s*H[ií]brido\s*</.test(bloco)) return 'hibrido';
  if (/xlink:href="#buildings"/.test(bloco)) return 'presencial';
  return null;
}

const MESES: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

/**
 * "Hoje", "Ontem" e "20 out" viram data. Precisão de DIA, sem hora — por isso
 * a origem gravada é `pagina_html`, não `metatag`. Sem ano: a data cai no ano
 * corrente, e se isso a puser no futuro (ler "28 dez" em 2 de janeiro), é do
 * ano anterior. Meio-dia de Brasília, para o dia não escorregar com o fuso.
 */
export function dataRelativa(texto: string, agora: Date): string | null {
  const t = texto.trim().toLowerCase();
  const brt = new Date(agora.getTime() - 3 * 3600 * 1000); // relógio de Brasília
  let ano = brt.getUTCFullYear();
  let mes = brt.getUTCMonth();
  let dia = brt.getUTCDate();

  if (t === 'ontem') {
    const d = new Date(Date.UTC(ano, mes, dia - 1));
    ano = d.getUTCFullYear(); mes = d.getUTCMonth(); dia = d.getUTCDate();
  } else if (t !== 'hoje') {
    const m = /^(\d{1,2})\s+([a-zç]{3})/.exec(t);
    const mesLido = m ? MESES[m[2]!] : undefined;
    if (!m || mesLido === undefined) return null;
    dia = Number(m[1]);
    mes = mesLido;
    if (Date.UTC(ano, mes, dia) > Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate())) ano--;
  }
  const ms = Date.UTC(ano, mes, dia, 15); // 12h em Brasília
  return new Date(Math.min(ms, agora.getTime())).toISOString();
}

/**
 * Vaga remota "em Todo Brasil", lida do bloco da vaga. **Só entra com o ícone
 * de home office**: "Todo Brasil" também marca vaga presencial sem cidade
 * cadastrada ("Operador de Loja Carrefour - Uberlândia"), e essa não tem feed
 * onde caber. Medido em 22/10: 12 home office, 8 presenciais em 21.
 */
export function vagaRemotaDoBloco(bloco: string, url: string, agora: Date): VagaDoInfojobs | null {
  if (modeloDoBloco(bloco) !== 'remoto') return null;

  const titulo = /js_vacancyHeaderTitle">([\s\S]*?)<\/h2>/.exec(bloco);
  const data = /caption text-medium text-nowrap text-right mb-8">\s*([^<]+?)\s*</.exec(bloco);
  const fonteId = /__(\d+)\.aspx/i.exec(url)?.[1];
  const cargo = titulo ? textoHtml(titulo[1]!) : '';
  const dataPublicacao = data ? dataRelativa(data[1]!, agora) : null;
  if (!cargo || !dataPublicacao || !fonteId) return null;

  const empresa =
    /title="([^"]+?) Trabalhe Conosco"/.exec(bloco)?.[1] ??
    (/Empresa confidencial/i.test(bloco) ? 'Empresa confidencial' : null);
  const descricao = /<p class="[^"]*white-space-pre-line[^"]*">([\s\S]*?)<\/p>/.exec(bloco);

  return {
    fonteId,
    url,
    cargo,
    empresa: empresa ? textoHtml(empresa) : 'não identificada',
    localizacao: 'Todo Brasil',
    cidadeSlug: null,
    uf: null,
    modelo: 'remoto',
    dataPublicacao,
    descricao: descricao ? textoHtml(descricao[1]!) || null : null,
    bruto: { origem: 'bloco_html', titulo: cargo, data: data![1] },
    tipoContrato: contratoDoBloco(bloco),
    origemData: 'pagina_html',
  };
}

export interface PedidoNoInfojobs {
  cargo: string;
  /** Ausente = Brasil inteiro. */
  cidade?: string | null;
  /** Sigla. Obrigatória quando há cidade — ver `urlDeBusca`. */
  uf?: string | null;
  janelaDias?: number;
  /** Teto de páginas de listagem (20 vagas cada). */
  maxPaginas?: number;
  /** Pausa entre requisições, em ms. É site de terceiro, não API. */
  intervaloMs?: number;
  agora?: Date;
  buscar?: typeof fetch;
}

export interface RespostaDoInfojobs {
  vagas: VagaDoInfojobs[];
  /** Páginas de vaga abertas. */
  vistos: number;
  foraDaJanela: number;
  outraFamilia: number;
  /** Página sem `JobPosting` e sem vaga remota legível no bloco — descartada. */
  semJobPosting: number;
  /** Vagas "em Todo Brasil" com home office, lidas do bloco da vaga (achado 39). */
  remotasDoBloco: number;
  /** "Todo Brasil" presencial: sem cidade, não cabe em feed nenhum. */
  todoBrasilPresencial: number;
  /** Cidade diferente e não remota. */
  localNaoServe: number;
  /** A listagem não respondeu. Distinto de "não tem vaga" (achado 24). */
  falhou: boolean;
}

/** Quantas vagas seguidas fora da janela encerram a busca. Destaque pago fura a ordem. */
const FORA_SEGUIDAS_PARA_PARAR = 5;

export async function buscarNoInfojobs(pedido: PedidoNoInfojobs): Promise<RespostaDoInfojobs> {
  const buscar = pedido.buscar ?? fetch;
  const agora = pedido.agora ?? new Date();
  const corte = agora.getTime() - (pedido.janelaDias ?? 7) * 24 * 60 * 60 * 1000;
  const maxPaginas = pedido.maxPaginas ?? 30;
  const intervalo = pedido.intervaloMs ?? 1000;
  const cidadeAlvo = pedido.cidade ? slugCidade(pedido.cidade) : null;
  // A busca do site casa por texto; senioridade no termo só estreita (achado 29).
  const termo = semSenioridade(pedido.cargo);

  const r: RespostaDoInfojobs = {
    vagas: [],
    vistos: 0,
    foraDaJanela: 0,
    outraFamilia: 0,
    semJobPosting: 0,
    remotasDoBloco: 0,
    todoBrasilPresencial: 0,
    localNaoServe: 0,
    falhou: false,
  };
  const abertos = new Set<string>();
  let primeira = true;

  const html = async (url: string): Promise<string | null> => {
    if (!primeira && intervalo > 0) await new Promise((ok) => setTimeout(ok, intervalo));
    primeira = false;
    try {
      const resposta = await buscar(url, { headers: CABECALHOS, signal: AbortSignal.timeout(20_000) });
      return resposta.ok ? await resposta.text() : null;
    } catch {
      return null;
    }
  };

  paginas: for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const listagem = await html(urlDeBusca(termo, pedido.cidade ?? null, pedido.uf ?? null, pagina));
    if (listagem === null) {
      // Só é queda se nada veio. Falhar na página 7 depois de seis boas é fim de
      // varredura com o que já se tem, não fonte fora do ar.
      if (pagina === 1) r.falhou = true;
      break;
    }

    const links = linksDaListagem(listagem).filter((u) => !abertos.has(u));
    if (links.length === 0) break;

    let foraSeguidas = 0;
    for (const url of links) {
      abertos.add(url);
      const pagVaga = await html(url);
      if (pagVaga === null) continue;
      r.vistos++;

      const jp = jobPostingDaPagina(pagVaga);
      const bloco = blocoDaVaga(pagVaga);
      let vaga = jp ? normalizarJobPosting(jp, url) : null;
      if (vaga) {
        // O contrato não está no JobPosting; vem do bloco da própria vaga.
        if (bloco) vaga.tipoContrato = contratoDoBloco(bloco);
      } else if (bloco) {
        // Sem JobPosting: o InfoJobs omite o bloco para vaga sem endereço.
        vaga = vagaRemotaDoBloco(bloco, url, agora);
        if (vaga) r.remotasDoBloco++;
        else if (modeloDoBloco(bloco) === 'presencial') r.todoBrasilPresencial++;
      }
      if (!vaga) {
        if (!jp && !(bloco && modeloDoBloco(bloco) === 'presencial')) r.semJobPosting++;
        continue;
      }

      if (Date.parse(vaga.dataPublicacao) < corte) {
        r.foraDaJanela++;
        if (++foraSeguidas >= FORA_SEGUIDAS_PARA_PARAR) break paginas;
        continue;
      }
      foraSeguidas = 0;

      if (!cargoBateNoTitulo(pedido.cargo, vaga.cargo).bate) {
        r.outraFamilia++;
        continue;
      }

      // Mesma promessa e mesmo portão da Gupy: presencial e híbrido na cidade,
      // remoto vale o Brasil.
      if (!(vaga.modelo === 'remoto' || cidadeAlvo === null || vaga.cidadeSlug === cidadeAlvo)) {
        r.localNaoServe++;
        continue;
      }

      r.vagas.push(vaga);
    }
  }

  log.info('infojobs consultado', {
    cargo: pedido.cargo,
    cidade: pedido.cidade ?? '(brasil)',
    vistos: r.vistos,
    aproveitadas: r.vagas.length,
    foraDaJanela: r.foraDaJanela,
    outraFamilia: r.outraFamilia,
    semJobPosting: r.semJobPosting,
    remotasDoBloco: r.remotasDoBloco,
    todoBrasilPresencial: r.todoBrasilPresencial,
    localNaoServe: r.localNaoServe,
    falhou: r.falhou,
  });

  return r;
}
