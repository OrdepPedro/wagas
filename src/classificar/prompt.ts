/**
 * Prompt e contrato de saída do classificador.
 *
 * O contrato é JSON estrito, um objeto por candidato, com o `id` de volta. Ele
 * existe por dois motivos práticos:
 *
 *   1. Os candidatos vão em LOTE para economizar requisição — o tier gratuito
 *      do Gemini limita chamadas por minuto, não tokens por chamada. Sem o `id`
 *      de volta não dá para saber qual julgamento é de qual candidato, e um
 *      desalinhamento silencioso gravaria a empresa errada na vaga certa.
 *   2. Item que não voltar não é chutado: fica pendente e a próxima rodada
 *      tenta de novo. Perder um item é barato; inventar um é caro.
 *
 * O que o prompt precisa carregar, e por quê (tudo medido, ver CLAUDE.md):
 *
 *   - o snippet de vaga do LinkedIn é contaminado pela barra lateral de "vagas
 *     similares", então empresa não pode sair dele sozinha;
 *   - o título de post vem reescrito pelo Google ("Fulano posted this"), então
 *     ali o sinal está no snippet, que é o começo do texto do post;
 *   - cargo adjacente conta (Product Owner numa busca por Product Manager);
 *   - as classes de falso positivo já observadas na SERP real.
 */
import type { Candidato, Extracao } from './tipos.ts';

/** Um julgamento do modelo, ainda não validado. */
export interface Julgamento {
  id: number;
  ehVaga: boolean;
  cargoBate: boolean;
  localBate: boolean;
  confianca: number;
  motivo: string;
  extracao: Extracao;
}

export const SENIORIDADES_VALIDAS = ['estagio', 'junior', 'pleno', 'senior', 'principal'] as const;
export const MODELOS_VALIDOS = ['remoto', 'hibrido', 'presencial'] as const;

/**
 * Schema para `responseSchema` do Gemini. O Groq não aceita schema, só
 * `json_object` — por isso o prompt também descreve o formato em texto.
 */
export const SCHEMA_RESPOSTA = {
  type: 'object',
  properties: {
    julgamentos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ehVaga: { type: 'boolean' },
          cargoBate: { type: 'boolean' },
          localBate: { type: 'boolean' },
          empresa: { type: 'string', nullable: true },
          cargo: { type: 'string', nullable: true },
          senioridade: { type: 'string', nullable: true, enum: [...SENIORIDADES_VALIDAS] },
          modelo: { type: 'string', nullable: true, enum: [...MODELOS_VALIDOS] },
          localizacao: { type: 'string', nullable: true },
          confianca: { type: 'number' },
          motivo: { type: 'string' },
        },
        required: ['id', 'ehVaga', 'cargoBate', 'localBate', 'confianca', 'motivo'],
      },
    },
  },
  required: ['julgamentos'],
} as const;

const INSTRUCOES = `Você classifica resultados de busca do Google para um agregador de vagas brasileiro.

Para cada item, decida:
- ehVaga: o resultado anuncia UMA vaga aberta específica? Página de listagem, artigo sobre carreira, post de opinião, divulgação de curso e post de networking NÃO são vaga.
- cargoBate: o cargo anunciado pertence à mesma família do cargo buscado?
- localBate: o local da vaga serve para quem buscou?

REGRA DE FAMÍLIA (vale para qualquer cargo, não só os deste exemplo):
- Mesma função e mesmo assunto = bate. Senioridade diferente não importa.
- Cargo adjacente bate: Product Owner numa busca por Product Manager, Assistente numa busca por Auxiliar, Cientista de Dados numa busca por Analista de Dados.
- Mesma palavra, outro assunto NÃO bate: "Project Manager" não é "Product Manager"; "Líder de Produtos Financeiros" em varejo não é gestão de produto de tecnologia; "Especialista II SAP EWM" não é Product Manager.
- Mesmo assunto, outra função NÃO bate: Product Designer não é Product Manager; Desenvolvedor Front-end não é Analista de Dados.

REGRA DE LOCAL (é a promessa do produto, não preferência):
- Vaga REMOTA / home office serve, desde que seja no Brasil. Não importa em que cidade fica a empresa: remoto vale o país inteiro.
- Vaga PRESENCIAL ou HÍBRIDA só serve se for na cidade buscada (ou na região metropolitana dela — bairro conta como a cidade).
- Vaga remota de FORA do Brasil não serve.
- Cidade que aparece só no nome da empresa, no perfil de quem publicou ou em hashtag NÃO é o local da vaga. Uma vaga home office anunciada por uma empresa de Aracaju continua sendo home office.

COMO LER CADA FONTE:
- linkedin_job: o título é confiável. O snippet NÃO é: a página traz a barra lateral de "vagas similares", e o snippet pode descrever outra vaga de outra empresa. Nunca tire a empresa do snippet sozinho; se ela não estiver no título, devolva empresa: null.
- linkedin_post: o título vem reescrito pelo Google ("Publicação de Fulano") e não diz nada. O sinal está no snippet, que é o começo do texto do post.
- ats_gupy: título e snippet são confiáveis. A empresa costuma estar no subdomínio da URL.

AUSÊNCIA DE EVIDÊNCIA NÃO É EVIDÊNCIA DE AUSÊNCIA:
- ehVaga: false só quando houver evidência POSITIVA de que não é vaga (é artigo, é post de opinião, é página de listagem, é divulgação de curso).
- localBate: false só quando o texto disser que a vaga é presencial ou híbrida em OUTRA cidade, ou fora do Brasil. Local não mencionado = localBate: true. A maioria dos títulos não diz o local, e reprovar por silêncio descartaria quase tudo.
- Se o texto disponível for curto ou genérico demais para decidir, mantenha ehVaga: true e cargoBate: true e ponha confianca abaixo de 0.5. Não confunda "não deu para saber" com "não é vaga" — o segundo descarta a vaga em silêncio, o primeiro fica registrado como decisão incerta.

confianca: 0 a 1, e vale SOMENTE para ehVaga e cargoBate. Abaixo de 0.5 significa "o texto não permitiu decidir se é vaga e se o cargo bate".
NÃO baixe a confianca porque o local não foi informado. Local desconhecido é o caso normal — a maioria dos títulos não diz cidade — e já está tratado por localBate: true.
motivo: no máximo 12 palavras, em português.
empresa, cargo, localizacao: null quando não estiverem explícitos. Não deduza.
senioridade: um de estagio, junior, pleno, senior, principal — ou null.
modelo: um de remoto, hibrido, presencial — ou null.

Responda SOMENTE com JSON no formato:
{"julgamentos":[{"id":0,"ehVaga":true,"cargoBate":true,"localBate":true,"empresa":null,"cargo":null,"senioridade":null,"modelo":null,"localizacao":null,"confianca":0.9,"motivo":"..."}]}
Um objeto por item recebido, com o mesmo id. Sem texto fora do JSON.`;

/** Corta o snippet: além disso é barra lateral, e barra lateral é ruído pago em token. */
const LIMITE_SNIPPET = 400;

export function montarPrompt(candidatos: Candidato[]): string {
  const itens = candidatos.map((c, i) => ({
    id: i,
    fonte: c.fonte,
    cargoBuscado: c.cargoBusca,
    cidadeBuscada: c.localizacaoBusca,
    url: c.urlCanonica,
    titulo: c.titulo,
    snippet: c.snippet.slice(0, LIMITE_SNIPPET),
  }));

  return `${INSTRUCOES}\n\nITENS:\n${JSON.stringify(itens, null, 1)}`;
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' || limpo.toLowerCase() === 'null' ? null : limpo;
}

function deLista<T extends string>(valor: unknown, validos: readonly T[]): T | null {
  const bruto = texto(valor)?.toLowerCase();
  return bruto && (validos as readonly string[]).includes(bruto) ? (bruto as T) : null;
}

/**
 * Extrai o JSON da resposta. Modelo em modo JSON às vezes embrulha em cerca de
 * markdown; um `JSON.parse` cru quebraria a rodada inteira por causa de três
 * crases.
 */
export function extrairJson(bruto: string): unknown {
  const semCerca = bruto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(semCerca);
  } catch {
    const inicio = semCerca.indexOf('{');
    const fim = semCerca.lastIndexOf('}');
    if (inicio === -1 || fim <= inicio) return null;
    try {
      return JSON.parse(semCerca.slice(inicio, fim + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Valida a resposta contra o lote enviado.
 *
 * Devolve só os julgamentos utilizáveis. Id fora do lote, id repetido e objeto
 * sem os campos obrigatórios são descartados em silêncio — o candidato
 * correspondente fica sem julgamento e volta na próxima rodada.
 */
export function interpretarResposta(bruto: string, tamanhoDoLote: number): Julgamento[] {
  const dados = extrairJson(bruto);
  if (!dados || typeof dados !== 'object') return [];

  const lista = (dados as { julgamentos?: unknown }).julgamentos;
  if (!Array.isArray(lista)) return [];

  const vistos = new Set<number>();
  const julgamentos: Julgamento[] = [];

  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;

    const id = typeof obj['id'] === 'number' ? obj['id'] : Number(obj['id']);
    if (!Number.isInteger(id) || id < 0 || id >= tamanhoDoLote || vistos.has(id)) continue;
    if (typeof obj['ehVaga'] !== 'boolean' || typeof obj['cargoBate'] !== 'boolean') continue;
    // `localBate` ausente vira `true`: o portão de local só reprova com
    // evidência, e um modelo que esqueceu o campo não é evidência de nada.
    const localBate = typeof obj['localBate'] === 'boolean' ? obj['localBate'] : true;

    const confiancaBruta = Number(obj['confianca']);
    const confianca = Number.isFinite(confiancaBruta)
      ? Math.min(Math.max(confiancaBruta, 0), 1)
      : 0;

    vistos.add(id);
    julgamentos.push({
      id,
      ehVaga: obj['ehVaga'],
      cargoBate: obj['cargoBate'],
      localBate,
      confianca,
      motivo: texto(obj['motivo']) ?? '',
      extracao: {
        empresa: texto(obj['empresa']),
        cargo: texto(obj['cargo']),
        senioridade: deLista(obj['senioridade'], SENIORIDADES_VALIDAS),
        modelo: deLista(obj['modelo'], MODELOS_VALIDOS),
        localizacao: texto(obj['localizacao']),
      },
    });
  }

  return julgamentos;
}
