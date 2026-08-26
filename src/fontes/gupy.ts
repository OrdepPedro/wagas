/**
 * Gupy — o portal público, pela API que ele mesmo usa.
 *
 * Por que esta fonte existe, e por que ela muda o desenho do produto:
 *
 * O Passo 4 fechou com o feed devolvendo VAZIO para qualquer cargo que a
 * varredura da Serper não tivesse coberto — "Enfermeiro" era o exemplo. A saída
 * óbvia (coletar na hora, pela Serper) esbarra em dois números: o saldo é finito
 * e não renova (2.133 créditos, ~18 por par cargo×cidade, ou seja ~118 pares na
 * vida inteira do produto), e uma coleta completa mais classificação demora mais
 * de um minuto — tempo que ninguém espera olhando tela em branco.
 *
 * Esta API resolve os dois. É pública, anônima, sem chave, e devolve o que a
 * SERP só dava de forma indireta e incompleta:
 *
 *   publishedDate   timestamp exato. `data_publicacao` estava null em 192 de 192
 *   workplaceType   remote/hybrid/on-site. `modelo` estava null em 53%
 *   careerPageName  a empresa. 28% estavam como "não identificada"
 *   city + state    estruturados, em vez de 25 grafias de São Paulo
 *
 * E, por consequência, **esta camada não precisa de LLM**. As três perguntas do
 * classificador — é vaga, o cargo bate, o local serve — viram: sim por
 * construção (é anúncio de ATS), `cargoBateNoTitulo` (determinístico, já
 * medido), e comparação de campo estruturado. Zero crédito, zero cota, resposta
 * em segundos.
 *
 * LIMITES, para não virar promessa que não se cumpre:
 *
 *  - **É uma fonte só.** O CLAUDE.md já registrava "fonte única de ATS (Gupy),
 *    risco não resolvido". Ela deixa de ser complemento e passa a sustentar o
 *    caso de cargo novo, então o risco cresceu.
 *  - **Inversamente correlacionada com tech** (achado 9), agora medido dentro
 *    da janela de 7 dias: Enfermeiro 100+, Auxiliar Administrativo 100+,
 *    Marketing 61, Dados 41, Product Manager 10, Front-end 3. Ela cobre o que a
 *    SERP cobria mal, e não substitui a SERP no que esta cobre bem.
 *  - **API não documentada.** É o endpoint que o próprio portal chama, sem
 *    autenticação e sobre dado público — a mesma categoria de "ATSs brasileiros
 *    públicos" que a restrição 3 autoriza, e nada a ver com a restrição 2, que
 *    trata de scraping do LinkedIn AUTENTICADO. Ainda assim pode mudar sem
 *    aviso: tudo aqui degrada para lista vazia em vez de quebrar o feed.
 */
import dns from 'node:dns';
import { cargoBateNoTitulo } from '../classificar/familia.ts';
import { normalizarLocal, slugCidade, type Modelo } from '../normalize/local.ts';
import { log } from '../logger.ts';

// Ambiente com DNS que devolve AAAA inalcançável derruba o fetch antes de sair.
// Preferir IPv4 é o que faz esta fonte funcionar em runner e em máquina local.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Node sem a API: segue com a ordem padrão.
}

const BASE = 'https://employability-portal.gupy.io/api/v1/jobs';

/** O portal se identifica assim; sem isso a API responde 400. */
const CABECALHOS = {
  accept: 'application/json',
  origin: 'https://portal.gupy.io',
  referer: 'https://portal.gupy.io/',
} as const;

/** Só os campos que usamos. O payload traz mais, e guardá-lo inteiro é o papel de `raw_results`. */
interface ItemBruto {
  id?: number;
  name?: string;
  careerPageName?: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  workplaceType?: string | null;
  isRemoteWork?: boolean;
  publishedDate?: string;
  jobUrl?: string;
  description?: string | null;
  type?: string | null;
}

export interface VagaDaGupy {
  fonteId: string;
  url: string;
  cargo: string;
  empresa: string;
  localizacao: string | null;
  cidadeSlug: string | null;
  uf: string | null;
  modelo: Modelo | null;
  dataPublicacao: string;
  descricao: string | null;
  bruto: unknown;
}

const MODELOS: Record<string, Modelo> = {
  remote: 'remoto',
  hybrid: 'hibrido',
  'on-site': 'presencial',
  onsite: 'presencial',
};

/**
 * Converte um item da API. Devolve `null` para item sem o mínimo — sem URL,
 * sem título ou sem data ele não é exibível nem deduplicável.
 */
export function normalizarItem(bruto: ItemBruto): VagaDaGupy | null {
  const cargo = bruto.name?.trim();
  const url = bruto.jobUrl?.trim();
  const data = bruto.publishedDate?.trim();
  if (!cargo || !url || !data) return null;

  const ms = Date.parse(data);
  if (!Number.isFinite(ms)) return null;

  const cidade = bruto.city?.trim() || null;
  const estado = bruto.state?.trim() || null;
  // Monta no formato "Cidade - Estado" e deixa `normalizarLocal` decidir — a
  // mesma função que preencheu `jobs.cidade_slug` pelo caminho da SERP. Duas
  // normalizações diferentes fariam o filtro de cidade discordar do dado.
  const localizacao = [cidade, estado].filter(Boolean).join(' - ') || null;
  const local = normalizarLocal(localizacao);

  const tipo = bruto.workplaceType?.toLowerCase().trim() ?? '';
  const modelo = MODELOS[tipo] ?? (bruto.isRemoteWork ? 'remoto' : null);

  return {
    fonteId: bruto.id !== undefined ? String(bruto.id) : url,
    url,
    cargo,
    empresa: bruto.careerPageName?.trim() || 'não identificada',
    localizacao,
    cidadeSlug: local.cidadeSlug,
    uf: local.uf,
    modelo,
    dataPublicacao: new Date(ms).toISOString(),
    descricao: bruto.description?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null,
    bruto,
  };
}

export interface PedidoNaGupy {
  cargo: string;
  /** Ausente = país inteiro. A API filtra por nome de cidade, não por slug. */
  cidade?: string | null;
  /** O "Só Remoto" do produto: a API tem o filtro nativo. */
  soRemoto?: boolean;
  /** Teto de itens trazidos. A API devolve no máximo 100 por página. */
  limite?: number;
  janelaDias?: number;
  agora?: Date;
  buscar?: typeof fetch;
}

const POR_PAGINA = 100;

export interface RespostaDaGupy {
  vagas: VagaDaGupy[];
  /** Quantos itens a API devolveu antes de qualquer filtro nosso. */
  vistos: number;
  /** Quantos caíram por estar fora da janela de 7 dias. */
  foraDaJanela: number;
  /** Quantos caíram porque o cargo não é da família buscada. */
  outraFamilia: number;
  /**
   * A fonte falhou (rede, erro HTTP)? Separado de "não veio nada" de propósito:
   * carimbar uma queda de rede como coleta bem-sucedida suprimiria a próxima
   * tentativa, e o feed ficaria vazio por meia hora por causa de um soluço.
   */
  falhou: boolean;
}

/**
 * Busca e filtra.
 *
 * A API ordena por data decrescente, então a paginação para assim que a página
 * sai inteira da janela — não adianta pedir a página seguinte de algo que só
 * fica mais velho. É o que segura o custo de rede em cargo com 800 vagas.
 *
 * `jobName` casa por substring, então "analista" traz "Analista de Tesouraria".
 * Quem separa é `cargoBateNoTitulo`, a mesma regra do pré-filtro — de graça, e
 * já medida.
 */
export async function buscarNaGupy(pedido: PedidoNaGupy): Promise<RespostaDaGupy> {
  const buscar = pedido.buscar ?? fetch;
  const agora = pedido.agora ?? new Date();
  const janelaDias = pedido.janelaDias ?? 7;
  const limite = pedido.limite ?? 200;
  const corte = agora.getTime() - janelaDias * 24 * 60 * 60 * 1000;
  const cidadeAlvo = pedido.cidade ? slugCidade(pedido.cidade) : null;

  const saida: VagaDaGupy[] = [];
  let vistos = 0;
  let foraDaJanela = 0;
  let outraFamilia = 0;
  let falhou = false;

  for (let offset = 0; offset < limite; offset += POR_PAGINA) {
    const params = new URLSearchParams({
      jobName: pedido.cargo,
      limit: String(Math.min(POR_PAGINA, limite - offset)),
      offset: String(offset),
    });
    if (pedido.cidade) params.set('city', pedido.cidade);
    if (pedido.soRemoto) params.set('workplaceType', 'remote');

    let itens: ItemBruto[];
    try {
      const resposta = await buscar(`${BASE}?${params}`, {
        headers: CABECALHOS,
        signal: AbortSignal.timeout(15_000),
      });
      if (!resposta.ok) {
        log.warn('gupy respondeu erro', { status: resposta.status, cargo: pedido.cargo });
        falhou = true;
        break;
      }
      const corpo = (await resposta.json()) as { data?: ItemBruto[] };
      itens = Array.isArray(corpo.data) ? corpo.data : [];
    } catch (falha) {
      // Fonte externa fora do ar não pode derrubar o feed: o que já veio vale.
      log.warn('gupy indisponível', { erro: String(falha).slice(0, 160) });
      falhou = true;
      break;
    }

    if (itens.length === 0) break;
    vistos += itens.length;

    let algumNaJanela = false;
    for (const item of itens) {
      const vaga = normalizarItem(item);
      if (!vaga) continue;

      if (Date.parse(vaga.dataPublicacao) < corte) {
        foraDaJanela++;
        continue;
      }
      algumNaJanela = true;

      if (!cargoBateNoTitulo(pedido.cargo, vaga.cargo).bate) {
        outraFamilia++;
        continue;
      }

      // Promessa do produto: presencial e híbrido só na cidade dele, remoto vale
      // o Brasil. Aqui os campos são estruturados, então o portão é comparação —
      // não julgamento de modelo de linguagem.
      const serve =
        vaga.modelo === 'remoto' ||
        cidadeAlvo === null ||
        vaga.cidadeSlug === cidadeAlvo;
      if (!serve) continue;

      saida.push(vaga);
    }

    // Ordenação é por data decrescente: página inteira fora da janela significa
    // que as seguintes também estão.
    if (!algumNaJanela) break;
    if (itens.length < POR_PAGINA) break;
  }

  log.info('gupy consultada', {
    cargo: pedido.cargo,
    cidade: pedido.cidade ?? '(brasil)',
    soRemoto: Boolean(pedido.soRemoto),
    vistos,
    aproveitadas: saida.length,
    foraDaJanela,
    outraFamilia,
    falhou,
  });

  return { vagas: saida, vistos, foraDaJanela, outraFamilia, falhou };
}
