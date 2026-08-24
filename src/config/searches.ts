/**
 * Combinações de busca: cargo x modelo x localização x fonte.
 *
 * ESTE É O ARQUIVO PARA EDITAR quando quiser cobrir um segmento novo.
 * Regra de ouro: cada página de cada combo custa 1 query da cota diária de 100.
 * `orcamentoDoCiclo()` no fim do arquivo diz quanto o conjunto atual consome.
 *
 * Os templates de dork abaixo são os validados no Passo 1 (ver passo1-google-dorks.md).
 * Não invente variante nova sem medir precisão antes — cota gasta não volta.
 */
import type { Combinacao, Modelo, Query, Segmento } from '../tipos.ts';

// ---------------------------------------------------------------------------
// Templates de dork
// ---------------------------------------------------------------------------

const TERMO_REMOTO = '("remoto" OR "home office" OR "100% remoto")';
const TERMO_HIBRIDO = '("híbrido" OR "hibrido")';
// Exatamente os negativos medidos no Passo 1. Acrescentar termo aqui muda a
// consulta e invalida a precisão medida — não mexer sem medir de novo.
const RUIDO_POSTS = '-curso -mentoria -programa';

/** Variantes de dork para linkedin_post, ambas medidas em ~100% de precisão no Passo 1. */
export type VariantePost = 'titulo' | 'corpo';

function termoModeloLinkedin(modelo: Modelo): string {
  if (modelo === 'remoto') return TERMO_REMOTO;
  if (modelo === 'hibrido') return TERMO_HIBRIDO;
  return '';
}

/** Bloco A: vaga formal indexada do LinkedIn. */
function dorkLinkedinJob(seg: Segmento): string {
  const partes = ['site:linkedin.com/jobs/view', `"${seg.cargo}"`];
  const modelo = termoModeloLinkedin(seg.modelo);
  if (modelo) partes.push(modelo);
  if (seg.localizacao) partes.push(`"${seg.localizacao}"`);
  return partes.join(' ');
}

/**
 * Bloco B: post de recrutador — o diferencial do produto.
 * Ranking de post segue engajamento, não data: `dateRestrict` é obrigatório aqui.
 */
function dorkLinkedinPost(seg: Segmento, variante: VariantePost): string {
  const cargo = seg.cargo.toLowerCase();
  const alvo = variante === 'titulo' ? `intitle:"${cargo}"` : `"${cargo}"`;
  const gatilho =
    variante === 'titulo'
      ? '("contratando" OR "vaga" OR "hiring")'
      : '("requisitos" OR "benefícios" OR "CLT" OR "PJ") ("vaga" OR "contratando")';
  // Sem termo de modelo, de propósito: o dork validado no Passo 1 não tem.
  // Post de recrutador raramente repete "remoto"/"home office" na forma exata,
  // e exigir isso derrubaria o recall justo no bloco que é o diferencial.
  // `seg.modelo` continua sendo gravado como metadado da busca — quem decide o
  // modelo da vaga é o classificador, no Passo 3.
  return ['site:linkedin.com/posts', alvo, gatilho, RUIDO_POSTS].join(' ');
}

/** Bloco C: ATS. Gupy é a única fonte de ATS viável medida até agora (risco de fonte única). */
function dorkGupy(seg: Segmento): string {
  const alternativas: string[] = [];
  if (seg.localizacao) alternativas.push(`"${seg.localizacao}"`);
  if (seg.modelo === 'remoto' || seg.modelo === 'qualquer') alternativas.push('"remoto"');
  if (seg.modelo === 'hibrido') alternativas.push('"híbrido"');
  const partes = ['site:gupy.io', `"${seg.cargo}"`];
  if (alternativas.length > 0) partes.push(`(${alternativas.join(' OR ')})`);
  return partes.join(' ');
}

// ---------------------------------------------------------------------------
// Construtores
// ---------------------------------------------------------------------------

interface Opcoes {
  paginas?: number;
  dateRestrict?: string;
  ativo?: boolean;
  /** Escapa dos templates quando precisar testar um dork específico. */
  dork?: string;
}

function jobLinkedin(id: string, seg: Segmento, opts: Opcoes = {}): Combinacao {
  return {
    id,
    ...seg,
    fonte: 'linkedin_job',
    // `after:` no Bloco A é redundante: o índice do LinkedIn já é fresco sozinho.
    dork: opts.dork ?? dorkLinkedinJob(seg),
    dateRestrict: opts.dateRestrict ?? null,
    paginas: opts.paginas ?? 2,
    ativo: opts.ativo ?? true,
  };
}

function postLinkedin(
  id: string,
  seg: Segmento,
  variante: VariantePost,
  opts: Opcoes = {},
): Combinacao {
  return {
    id,
    ...seg,
    fonte: 'linkedin_post',
    dork: opts.dork ?? dorkLinkedinPost(seg, variante),
    dateRestrict: opts.dateRestrict ?? 'd7',
    // Post com janela de 7 dias raramente enche 2 páginas; a segunda vira cota jogada fora.
    paginas: opts.paginas ?? 1,
    ativo: opts.ativo ?? true,
  };
}

function gupy(id: string, seg: Segmento, opts: Opcoes = {}): Combinacao {
  return {
    id,
    ...seg,
    fonte: 'ats_gupy',
    dork: opts.dork ?? dorkGupy(seg),
    dateRestrict: opts.dateRestrict ?? null,
    paginas: opts.paginas ?? 2,
    ativo: opts.ativo ?? true,
  };
}

// ---------------------------------------------------------------------------
// As 15 combinações
// ---------------------------------------------------------------------------

export const COMBINACOES: Combinacao[] = [
  // --- Product Manager -----------------------------------------------------
  jobLinkedin('pm-bh-job', { cargo: 'Product Manager', modelo: 'qualquer', localizacao: 'Belo Horizonte' }),
  jobLinkedin('pm-remoto-job', { cargo: 'Product Manager', modelo: 'remoto', localizacao: null }),
  jobLinkedin('pm-sp-job', { cargo: 'Product Manager', modelo: 'qualquer', localizacao: 'São Paulo' }),
  gupy('pm-bh-gupy', { cargo: 'Product Manager', modelo: 'remoto', localizacao: 'Belo Horizonte' }),
  postLinkedin('pm-remoto-post-titulo', { cargo: 'Product Manager', modelo: 'remoto', localizacao: null }, 'titulo'),
  postLinkedin('pm-remoto-post-corpo', { cargo: 'Product Manager', modelo: 'remoto', localizacao: null }, 'corpo'),

  // --- Product Designer ----------------------------------------------------
  jobLinkedin('pd-sp-job', { cargo: 'Product Designer', modelo: 'qualquer', localizacao: 'São Paulo' }),
  jobLinkedin('pd-remoto-job', { cargo: 'Product Designer', modelo: 'remoto', localizacao: null }),
  gupy('pd-sp-gupy', { cargo: 'Product Designer', modelo: 'remoto', localizacao: 'São Paulo' }),

  // --- Engenharia ----------------------------------------------------------
  jobLinkedin('front-remoto-job', { cargo: 'Desenvolvedor Front-end', modelo: 'remoto', localizacao: null }),
  gupy('front-remoto-gupy', { cargo: 'Desenvolvedor Front-end', modelo: 'remoto', localizacao: null }),

  // --- Dados ---------------------------------------------------------------
  jobLinkedin('dados-remoto-job', { cargo: 'Analista de Dados', modelo: 'remoto', localizacao: null }),
  jobLinkedin('dados-bh-job', { cargo: 'Analista de Dados', modelo: 'qualquer', localizacao: 'Belo Horizonte' }),
  postLinkedin('dados-remoto-post', { cargo: 'Analista de Dados', modelo: 'remoto', localizacao: null }, 'titulo'),

  // --- Fora do núcleo tech (checa se o pipeline generaliza) -----------------
  jobLinkedin('mkt-sp-job', { cargo: 'Analista de Marketing', modelo: 'hibrido', localizacao: 'São Paulo' }),
];

// ---------------------------------------------------------------------------
// Validação e orçamento
// ---------------------------------------------------------------------------

/** Roda no import: erro de config quebra o coletor antes de gastar cota, não no meio da rodada. */
export function validarCombinacoes(combos: Combinacao[] = COMBINACOES): void {
  const vistos = new Set<string>();
  for (const c of combos) {
    if (vistos.has(c.id)) throw new Error(`combo com id duplicado: ${c.id}`);
    vistos.add(c.id);
    if (c.paginas < 1 || c.paginas > 10) {
      throw new Error(`combo ${c.id}: paginas fora de 1..10 (${c.paginas})`);
    }
    if (c.fonte === 'linkedin_post' && !c.dateRestrict) {
      throw new Error(
        `combo ${c.id}: linkedin_post exige dateRestrict — ranking de post segue engajamento, não data`,
      );
    }
  }
}

export function combosAtivos(combos: Combinacao[] = COMBINACOES): Combinacao[] {
  return combos.filter((c) => c.ativo);
}

/** Quantas queries da cota um ciclo completo consome. */
export function orcamentoDoCiclo(combos: Combinacao[] = COMBINACOES): number {
  return combosAtivos(combos).reduce((soma, c) => soma + c.paginas, 0);
}

/** Expande combos em queries individuais (start = 1, 11, 21...). */
export function expandirQueries(combos: Combinacao[] = COMBINACOES): Query[] {
  const queries: Query[] = [];
  for (const combo of combosAtivos(combos)) {
    for (let pagina = 1; pagina <= combo.paginas; pagina++) {
      queries.push({ combo, pagina, start: (pagina - 1) * 10 + 1 });
    }
  }
  return queries;
}

validarCombinacoes();
