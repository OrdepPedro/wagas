/**
 * Greenhouse como fonte: o quadro público de cada empresa (achado 36).
 *
 *   boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
 *
 * API oficial, documentada, sem chave. Uma requisição devolve o quadro inteiro,
 * com data de publicação, empresa e descrição completa em 100% das vagas: o
 * dado que o currículo adaptado exige e que a SERP nunca deu.
 *
 * O que dá trabalho é o LOCAL. Ele é texto livre, e cada empresa escreve de um
 * jeito (conferido em 14/11 nos 16 quadros vivos):
 *
 *   "Sao Paulo, Sao Paulo, Brasil"            Stone
 *   "Belo Horizonte, MG; São Paulo, SP"       Inter — mais de uma cidade
 *   "São Paulo, Rio de Janeiro ou Teletrabalho"  BTG
 *   "Brazil (São Paulo - Hybrid)"             Wellhub — país primeiro
 *   "Curitiba or São Paulo | Hybrid"          EBANX — modelo no meio do local
 *   "Remoto", "Brasil", "Brazil (Remote)"     sem cidade
 *
 * Uma vaga anunciada em várias cidades vira uma entrada por cidade em `locais`:
 * quem busca em Curitiba precisa ver a vaga "BH; Curitiba; Recife; SP".
 */
import { decodificarEntidades } from '../normalize/texto.ts';
import { modeloDoTexto, normalizarLocal, ufDe, type LocalNormalizado, type Modelo } from '../normalize/local.ts';
import type { QuadroGreenhouse } from '../config/greenhouse.ts';
import type { VagaDaGupy } from './gupy.ts';

export interface LocalDaVaga extends LocalNormalizado {
  /** O pedaço do texto que deu origem a esta entrada, para `jobs.localizacao`. */
  localizacao: string | null;
}

export type VagaDoGreenhouse = VagaDaGupy & { locais: LocalDaVaga[] };

interface ItemBruto {
  id?: number;
  title?: string;
  absolute_url?: string;
  first_published?: string | null;
  updated_at?: string | null;
  content?: string | null;
  location?: { name?: string | null } | null;
}

/**
 * As 27 capitais. Conjunto fechado, como as UFs. Só servem para o quadro
 * internacional: lá "Curitiba | On-site" não traz país, e sem isto a EBANX
 * perderia as vagas da própria sede.
 */
const CAPITAIS = new Set([
  'rio-branco', 'maceio', 'macapa', 'manaus', 'salvador', 'fortaleza', 'brasilia',
  'vitoria', 'goiania', 'sao-luis', 'cuiaba', 'campo-grande', 'belo-horizonte',
  'belem', 'joao-pessoa', 'curitiba', 'recife', 'teresina', 'rio-de-janeiro',
  'natal', 'porto-alegre', 'porto-velho', 'boa-vista', 'florianopolis',
  'sao-paulo', 'aracaju', 'palmas',
]);

/** Palavra de modelo de trabalho escrita dentro do local. Sai antes de ler a cidade. */
const PALAVRA_DE_MODELO =
  /\b(100\s*%\s*)?(remot[oa]s?|remote|h[íi]brid[oa]s?|hybrid|on-?site|presencial|teletrabalho|home\s*office)\b/gi;

/** Separadores de alternativa: "A; B", "A ou B", "A or B", "A e B". */
const ALTERNATIVAS = /;|\s+ou\s+|\s+or\s+|\s+e\s+|\s+and\s+/i;

/**
 * Lista de cidades separada por vírgula ou barra, quando cada parte é nome de
 * estado por extenso e são estados diferentes: "São Paulo, Rio de Janeiro".
 * Sem esta regra, `normalizarLocal` lê isso como cidade São Paulo no estado do
 * Rio. "Sao Paulo, Sao Paulo" (mesmo estado) e "São Paulo/SP" (sigla) não caem
 * aqui e seguem como endereço.
 */
function listaDeEstados(texto: string): string[] | null {
  const partes = texto.split(/[,/]/).map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2) return null;
  const ufs = partes.map((p) => (p.length > 2 ? ufDe(p) : null));
  if (ufs.some((u) => u === null)) return null;
  return new Set(ufs).size === partes.length ? partes : null;
}

/** "Brazil (São Paulo - Hybrid)" → "São Paulo - Hybrid, Brazil". */
function paisDepois(texto: string): string {
  const m = /^\s*([^()]+?)\s*\(([^)]*)\)\s*$/.exec(texto);
  return m ? `${m[2]}, ${m[1]}` : texto;
}

/** Tira separador sobrando nas pontas depois de remover a palavra de modelo. */
function aparar(texto: string): string {
  return texto.replace(/^[\s,|/\-–—]+|[\s,|/\-–—]+$/g, '').replace(/\s+/g, ' ');
}

/**
 * Decompõe o `location.name` nos locais que a vaga atende.
 *
 * Devolve lista vazia quando nada serve: o quadro é internacional e o local não
 * diz o país, ou o local é confirmadamente fora do Brasil.
 */
export function locaisDoGreenhouse(bruto: string | null | undefined, soBrasil: boolean): LocalDaVaga[] {
  const texto = (bruto ?? '').trim();
  if (!texto) return soBrasil ? [{ localizacao: null, cidadeSlug: null, uf: null, paisBr: true }] : [];

  // "London l Remote": o "l" minúsculo é separador, não letra.
  const sem = paisDepois(texto).replace(/\s+l\s+/g, ' | ');
  const alternativas = sem
    .split(ALTERNATIVAS)
    .flatMap((a) => {
      const limpa = aparar(a.replace(PALAVRA_DE_MODELO, ''));
      return listaDeEstados(limpa) ?? [limpa];
    })
    .map(aparar);

  const saida: LocalDaVaga[] = [];
  const vistos = new Set<string>();

  for (const alt of alternativas) {
    if (alt === '') {
      // Sobrou só a palavra de modelo ("Remoto", "Brazil (Remote)" já vira
      // "Brazil"). Sem país escrito, quem decide é o quadro.
      if (soBrasil) empurrar({ localizacao: null, cidadeSlug: null, uf: null, paisBr: true });
      continue;
    }
    const local = normalizarLocal(alt);
    if (local.paisBr === false) continue;
    if (local.paisBr === null) {
      const capital = local.cidadeSlug !== null && CAPITAIS.has(local.cidadeSlug);
      if (!soBrasil && !capital) continue;
    }
    empurrar({ localizacao: alt, ...local, paisBr: true });
  }

  // Uma entrada sem cidade não acrescenta nada quando a vaga já tem cidade: o
  // balde remoto do feed não olha cidade, e qualquer entrada com o modelo
  // remoto já o alimenta.
  const comCidade = saida.filter((l) => l.cidadeSlug !== null);
  return comCidade.length > 0 ? comCidade : saida.slice(0, 1);

  function empurrar(l: LocalDaVaga) {
    const chave = l.cidadeSlug ?? '';
    if (vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(l);
  }
}

/**
 * O `content` vem como HTML com as entidades escapadas (`&lt;p&gt;`). Decodifica
 * primeiro e tira as tags depois — a ordem do achado 8. Quebra de bloco vira
 * quebra de linha, porque a descrição vai inteira para o currículo adaptado.
 */
export function textoDaDescricao(content: string | null | undefined): string | null {
  if (!content) return null;
  const texto = decodificarEntidades(content)
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  const limpo = decodificarEntidades(texto)
    .split('\n')
    .map((l) => l.replace(/[\s ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return limpo || null;
}

const MODELO_DECLARADO: Record<string, Modelo> = {
  presencial: 'presencial', onsite: 'presencial', 'on-site': 'presencial',
  hibrido: 'hibrido', 'híbrido': 'hibrido', hybrid: 'hibrido',
  remoto: 'remoto', remote: 'remoto', 'remote-first': 'remoto',
};

/**
 * Modelo de trabalho DECLARADO na descrição. Só três formas contam:
 *
 *   "Modelo de Trabalho: Híbrido", "Modelo: Remoto", "atua no modelo presencial"
 *   a tag do LinkedIn que o Greenhouse repassa: #LI-ONSITE, #LI-HYBRID, #LI-REMOTE
 *   "100% presencial", "100% remoto"
 *
 * Palavra solta não conta, e foi medido por quê (14/11): a Stone escreve em
 * TODAS as vagas "Auxílio home office (apenas para contratos Híbridos ou
 * Remotos)", e o QuintoAndar anuncia "Work From Anywhere" nos benefícios. Ler a
 * palavra solta marcava vendedor externo como híbrido e um Account Manager
 * presencial como remoto, que é o erro caro: vaga remota entra no feed de toda
 * cidade.
 */
export function modeloDaDescricao(texto: string | null | undefined): Modelo | null {
  if (!texto) return null;
  const linha = /\bmodelo(?:\s+de\s+trabalho)?\s*[:\-–]?\s*(?:é\s+)?(?:100\s*%\s*)?(presencial|h[íi]brido|hybrid|remote-first|remoto|remote|on-?site)(?![a-z])/i.exec(texto);
  if (linha) return MODELO_DECLARADO[linha[1]!.toLowerCase().replace('on-site', 'onsite')] ?? null;
  const tag = /#LI-(REMOTE|HYBRID|ONSITE)\b/i.exec(texto);
  if (tag) return MODELO_DECLARADO[tag[1]!.toLowerCase()] ?? null;
  const cem = /\b100\s*%\s*(presencial|remoto|remote|h[íi]brido)(?![a-z])/i.exec(texto);
  if (cem) return MODELO_DECLARADO[cem[1]!.toLowerCase()] ?? null;
  return null;
}

/**
 * Converte um item do quadro. `null` para item sem o mínimo (sem título, URL ou
 * data) ou sem nenhum local que sirva ao produto.
 */
export function normalizarItemGreenhouse(bruto: ItemBruto, quadro: QuadroGreenhouse): VagaDoGreenhouse | null {
  const cargo = decodificarEntidades(bruto.title ?? '').replace(/\s+/g, ' ').trim();
  const url = bruto.absolute_url?.trim();
  const ms = Date.parse(bruto.first_published ?? '');
  if (!cargo || !url || !Number.isFinite(ms) || bruto.id === undefined) return null;

  const locais = locaisDoGreenhouse(bruto.location?.name, quadro.soBrasil);
  if (locais.length === 0) return null;

  const descricao = textoDaDescricao(bruto.content);
  // O título vence: "Analista de Tesouraria (Presencial/SP)" veio com o local
  // "Remoto" na Stone, e quem escreveu o título foi quem descreveu a vaga.
  const modelo: Modelo | null =
    modeloDoTexto(cargo) ?? modeloDoTexto(bruto.location?.name) ?? modeloDaDescricao(descricao);
  const principal = locais[0]!;

  return {
    fonteId: String(bruto.id),
    url,
    cargo,
    empresa: quadro.empresa,
    localizacao: bruto.location?.name?.trim() || null,
    cidadeSlug: principal.cidadeSlug,
    uf: principal.uf,
    modelo,
    dataPublicacao: new Date(ms).toISOString(),
    descricao,
    // Sem o `content`: ele já está em `descricao`, e duplicaria o maior campo.
    bruto: { ...bruto, content: undefined, quadro: quadro.slug },
    locais,
  };
}

export interface RespostaDoGreenhouse {
  vagas: VagaDoGreenhouse[];
  /** Itens que o quadro listou, antes de qualquer corte. */
  vistos: number;
  /** Ids de TODO o quadro, para encerrar o que sumiu. Só vale com `falhou: false`. */
  idsNoQuadro: string[];
  /** Da janela, mas cortadas: local que não serve ao produto, ou item sem o mínimo. */
  descartadas: number;
  /** Rede, 5xx, 404 ou corpo ilegível. Distinto de quadro vazio (achado 24). */
  falhou: boolean;
}

/**
 * Baixa um quadro inteiro. Devolve só as vagas publicadas desde `desde`, mas
 * conta e lista o quadro todo — a lista completa é o que permite encerrar vaga
 * que a empresa tirou do ar.
 */
export async function buscarNoGreenhouse(
  quadro: QuadroGreenhouse,
  desde: Date,
  buscar: typeof fetch = fetch,
): Promise<RespostaDoGreenhouse> {
  const vazia = { vagas: [], vistos: 0, idsNoQuadro: [], descartadas: 0 };
  let dado: { jobs?: ItemBruto[] };
  try {
    const r = await buscar(`https://boards-api.greenhouse.io/v1/boards/${quadro.slug}/jobs?content=true`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return { ...vazia, falhou: true };
    dado = (await r.json()) as { jobs?: ItemBruto[] };
  } catch {
    return { ...vazia, falhou: true };
  }
  if (!Array.isArray(dado?.jobs)) return { ...vazia, falhou: true };

  const vagas: VagaDoGreenhouse[] = [];
  let descartadas = 0;
  for (const item of dado.jobs) {
    const ms = Date.parse(item.first_published ?? '');
    if (!Number.isFinite(ms) || ms < desde.getTime()) continue;
    const vaga = normalizarItemGreenhouse(item, quadro);
    if (vaga) vagas.push(vaga);
    else descartadas++;
  }

  return {
    vagas,
    vistos: dado.jobs.length,
    idsNoQuadro: dado.jobs.flatMap((j) => (j.id === undefined ? [] : [String(j.id)])),
    descartadas,
    falhou: false,
  };
}
