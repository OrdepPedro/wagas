/**
 * Comparação do currículo com uma vaga do Mapa: quantos requisitos da vaga a
 * pessoa tem, e o que falta.
 *
 * Duas etapas, porque os requisitos de uma vaga não dependem do currículo:
 *
 * 1. EXTRAÇÃO, uma vez por vaga, guardada (`vaga_requisitos`, 0024). Medido em
 *    17/11: pedindo extração e classificação na mesma chamada, a lista mudou
 *    entre duas rodadas em 4 de 6 vagas (8 de 12 virou 4 de 8, e numa delas
 *    SQL, Power BI, Python e Excel sumiram da lista). O veredito de cada item
 *    era estável; o placar era sorteio. Com a lista congelada, o "X de Y" é o
 *    mesmo para todo mundo e em toda rodada. A vaga é texto público, então essa
 *    etapa pode ir ao Gemini sem levar dado pessoal.
 *
 * 2. CLASSIFICAÇÃO do CV contra essa lista, com os mesmos três status do
 *    medidor (`demonstrado`, `sem_contexto`, `ausente`). O modelo tem de CITAR
 *    o trecho do CV que prova o requisito, e o código confere que o trecho
 *    existe; citação que não está no CV rebaixa o status. Dizer "você tem" sem
 *    ter é o erro caro desta tela.
 *
 * Nada aqui guarda nada; quem grava é `web/lib/mapa.ts`.
 */
import type { Requisito, StatusRequisito } from '../curriculo/tipos.ts';

/** Mesmos tetos do medidor (`curriculo/prompt.ts`). */
const MAX_CURRICULO = 16_000;
const MAX_VAGA = 8_000;
const MAX_REQUISITOS = 15;

export interface VagaParaComparar {
  cargo: string;
  empresa: string;
  descricao: string;
}

export interface RequisitoDaVaga {
  termo: string;
  essencial: boolean;
  /**
   * Formação, registro profissional, certificação, idioma, CNH: coisa que se
   * TEM, não que se usa. Constar no CV basta. Medido em 17/11: "COREN-SP
   * ativo" saiu "demonstrado" numa rodada e "sem contexto" na outra, mudando o
   * placar de 1 de 3 para 2 de 3 com o mesmo CV. Marcado na extração (que é
   * congelada), o status de credencial sai do código, não do sorteio.
   */
  credencial?: boolean;
}

export interface RequisitoComparado extends Requisito {
  /** Trecho do CV que prova o requisito, conferido pelo código. Null quando ausente. */
  trecho: string | null;
}

export interface Comparacao {
  requisitos: RequisitoComparado[];
  /** Quantos status o código rebaixou por citação que não está no CV. */
  rebaixados: number;
}

export class ComparacaoInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ComparacaoInvalida';
  }
}

function lerJson(bruto: string): unknown {
  try {
    return JSON.parse(bruto);
  } catch {
    throw new ComparacaoInvalida('resposta do LLM não é JSON');
  }
}

/* ---------------------------------------------------------------------------
 * 1. Extração dos requisitos da vaga
 * ------------------------------------------------------------------------- */

export function montarPromptDeExtracao(vaga: VagaParaComparar): string {
  return `Você é um recrutador lendo uma vaga do mercado brasileiro. Liste os requisitos que um candidato precisa ter.

REGRAS
- De 6 a ${MAX_REQUISITOS} requisitos: ferramentas, competências técnicas, tempo de experiência, formação, certificações, registros profissionais, idiomas.
- Um requisito por item, com termo curto como a vaga escreve ("SQL", "COREN ativo", "Inglês avançado"). Não junte dois numa linha.
- "essencial" = obrigatório (seção de requisitos, "necessário", "obrigatório"). Diferencial, "desejável" ou "será um plus" = essencial false.
- "credencial" = algo que se possui e se comprova por documento: formação, especialização, registro profissional (COREN, CRM, CREA, OAB), certificação, idioma, CNH. Ferramenta, competência e tempo de experiência = credencial false.
- Atividade do dia a dia ("atender clientes", "elaborar relatórios") só entra se for também uma competência exigida.
- Nada de requisito genérico que toda vaga tem ("comunicação", "proatividade") a menos que a vaga o destaque.
- Responda em português do Brasil, só com JSON neste formato:
{"requisitos":[{"termo":"...","essencial":true,"credencial":false}]}

VAGA
Cargo: ${vaga.cargo}
Empresa: ${vaga.empresa}
${vaga.descricao.slice(0, MAX_VAGA)}`;
}

export const SCHEMA_EXTRACAO = {
  type: 'object',
  properties: {
    requisitos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { termo: { type: 'string' }, essencial: { type: 'boolean' }, credencial: { type: 'boolean' } },
        required: ['termo', 'essencial', 'credencial'],
      },
    },
  },
  required: ['requisitos'],
};

export function interpretarExtracao(bruto: string): RequisitoDaVaga[] {
  const lista = (lerJson(bruto) as { requisitos?: unknown } | null)?.requisitos;
  if (!Array.isArray(lista)) throw new ComparacaoInvalida('resposta sem requisitos');
  const vistos = new Set<string>();
  const requisitos: RequisitoDaVaga[] = [];
  for (const r of lista as Array<Record<string, unknown>>) {
    const termo = typeof r['termo'] === 'string' ? r['termo'].trim().slice(0, 120) : '';
    if (!termo || vistos.has(termo.toLowerCase())) continue;
    vistos.add(termo.toLowerCase());
    requisitos.push({ termo, essencial: r['essencial'] === true, credencial: r['credencial'] === true });
  }
  // Menos de 3 é vaga que não diz o que pede: congelar isso seria pior que não comparar.
  if (requisitos.length < 3) throw new ComparacaoInvalida('menos de 3 requisitos na vaga');
  return requisitos.slice(0, MAX_REQUISITOS);
}

/* ---------------------------------------------------------------------------
 * 2. Classificação do currículo contra a lista
 * ------------------------------------------------------------------------- */

export function montarPromptDeClassificacao(curriculo: string, requisitos: RequisitoDaVaga[]): string {
  const lista = requisitos.map((r, i) => `${i + 1}. ${r.termo}`).join('\n');
  return `Você é um recrutador conferindo se um currículo atende os requisitos de uma vaga, para o mercado brasileiro.

Para CADA requisito da lista, na mesma ordem e com o termo exatamente como está, procure no CURRÍCULO:
- "demonstrado": aparece em uso real (experiência, projeto, resultado, formação concluída, registro ativo).
- "sem_contexto": aparece só numa lista de competências, ou com outra grafia ou equivalente próximo (ponha a grafia do CV em grafiaNoCurriculo).
- "ausente": não aparece.

Em "trecho", copie LITERALMENTE de 3 a 15 palavras do currículo que provam o status. Copie, não resuma nem traduza. Se "ausente", trecho é null.

REGRAS
- Avalie só o que está escrito. Nunca presuma experiência que o texto não mostra.
- Tempo de experiência só é "demonstrado" se as datas do currículo somam o tempo pedido.
- Responda só com JSON neste formato, um item por requisito:
{"requisitos":[{"termo":"...","status":"demonstrado","grafiaNoCurriculo":null,"trecho":"..."}]}

REQUISITOS
${lista}

CURRÍCULO
${curriculo.slice(0, MAX_CURRICULO)}`;
}

const STATUS = new Set<StatusRequisito>(['demonstrado', 'sem_contexto', 'ausente']);

/** Minúsculas, sem acento, sem pontuação, espaço único: o que sobra de uma cópia "literal" de LLM. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim();
}

/** O termo aparece no CV como palavra (ou sequência de palavras) inteira? */
function aparece(cvNormalizado: string, termo: string): boolean {
  const t = normalizar(termo);
  return t.length > 0 && ` ${cvNormalizado} `.includes(` ${t} `);
}

/**
 * Lê a classificação e confere cada citação contra o CV.
 *
 * A saída é a LISTA DA VAGA, na ordem dela: termo e "essencial" vêm de lá,
 * nunca do modelo. Requisito que o modelo pulou é erro — completar com
 * "ausente" diria "falta" sobre algo que ninguém conferiu.
 *
 * Citação ausente do CV: se o termo (ou a grafia que o modelo diz ter achado)
 * aparece no CV, o requisito cai para `sem_contexto`; se não, para `ausente`.
 * O rebaixamento é contado, para a taxa de citação inventada ficar medida.
 */
export function interpretarComparacao(bruto: string, curriculo: string, daVaga: RequisitoDaVaga[]): Comparacao {
  const lista = (lerJson(bruto) as { requisitos?: unknown } | null)?.requisitos;
  if (!Array.isArray(lista)) throw new ComparacaoInvalida('resposta sem requisitos');

  const porTermo = new Map<string, Record<string, unknown>>();
  for (const r of lista as Array<Record<string, unknown>>) {
    if (typeof r['termo'] === 'string') porTermo.set(normalizar(r['termo']), r);
  }

  const cv = normalizar(curriculo);
  let rebaixados = 0;
  const requisitos = daVaga.map((alvo, i): RequisitoComparado => {
    // Pelo termo; se o modelo reescreveu o termo, pela posição.
    const r = porTermo.get(normalizar(alvo.termo)) ?? (lista[i] as Record<string, unknown> | undefined);
    let status = r?.['status'] as StatusRequisito;
    if (!r || !STATUS.has(status)) throw new ComparacaoInvalida(`requisito "${alvo.termo}" sem classificação`);

    const grafiaBruta = typeof r['grafiaNoCurriculo'] === 'string' ? r['grafiaNoCurriculo'].trim() : '';
    const grafia = grafiaBruta && normalizar(grafiaBruta) !== normalizar(alvo.termo) ? grafiaBruta : null;
    let trecho = typeof r['trecho'] === 'string' ? r['trecho'].trim() : '';

    if (status !== 'ausente') {
      const citado = normalizar(trecho);
      // Menos de duas palavras não prova nada: "Python" casaria com qualquer lista.
      const confere = citado.split(' ').length >= 2 && cv.includes(citado);
      if (!confere) {
        rebaixados++;
        const noCv = aparece(cv, alvo.termo) || (grafia !== null && aparece(cv, grafia));
        status = noCv ? 'sem_contexto' : 'ausente';
        trecho = '';
      }
    } else {
      trecho = '';
    }
    // Credencial citada e conferida no CV é credencial que a pessoa tem.
    if (alvo.credencial && status === 'sem_contexto' && trecho) status = 'demonstrado';

    return {
      termo: alvo.termo,
      essencial: alvo.essencial,
      status,
      grafiaNoCurriculo: grafia,
      trecho: trecho || null,
    };
  });

  return { requisitos, rebaixados };
}

/* ---------------------------------------------------------------------------
 * Placar
 * ------------------------------------------------------------------------- */

export interface Placar {
  /** Requisitos contados no placar: os essenciais, ou todos se a vaga não marcou nenhum. */
  total: number;
  demonstrados: number;
  semContexto: number;
  /** True quando o placar é sobre os essenciais. */
  essenciais: boolean;
}

/** "Você tem X de Y". Mesma base de `pontuarRequisitos` do medidor. */
export function placar(requisitos: Requisito[]): Placar {
  const essenciais = requisitos.filter((r) => r.essencial);
  const contados = essenciais.length > 0 ? essenciais : requisitos;
  return {
    total: contados.length,
    demonstrados: contados.filter((r) => r.status === 'demonstrado').length,
    semContexto: contados.filter((r) => r.status === 'sem_contexto').length,
    essenciais: essenciais.length > 0,
  };
}
