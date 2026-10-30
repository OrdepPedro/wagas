/**
 * Estruturador de currículo para LinkedIn e Gupy: os modos `linkedin` e `gupy`
 * do contexto de currículo que o Pedro trouxe em 28/10 (seções 10.1, 10.2, 12.4
 * e 12.5), comprimidos ao que cada plataforma pede.
 *
 * As duas plataformas pedem coisas opostas, e é por isso que são modos e não
 * um só texto: no LinkedIn o recrutador PROCURA a pessoa (o objetivo é ser
 * encontrado); na Gupy a pessoa se candidata e a plataforma ORDENA a
 * candidatura pelos campos Experiência e Habilidades (o objetivo é ser bem
 * lido nesses campos).
 *
 * O que é fixo — checklist de revisão, aviso das candidaturas ativas — fica no
 * código, não no prompt. Pedir ao modelo um texto que não muda é gastar cota
 * para receber, de vez em quando, uma versão pior do mesmo texto (achado 11).
 *
 * Como no medidor, nada aqui guarda o currículo.
 */
import type { Provedor } from '../classificar/llm.ts';
import { CurriculoSemTexto } from './medir.ts';
import { MAX_CURRICULO, MAX_VAGA, RespostaInvalida } from './prompt.ts';
import type { Extracao } from './tipos.ts';

export type Plataforma = 'linkedin' | 'gupy';

export const PLATAFORMAS: readonly Plataforma[] = ['linkedin', 'gupy'];

/** Limites das próprias plataformas. São teto, não meta. */
export const MAX_HABILIDADES_GUPY = 30;
export const MAX_COMPETENCIAS_LINKEDIN = 30;
const MAX_COMPETENCIAS_POR_EXPERIENCIA = 5;
const MAX_HEADLINE = 220;

export interface ExperienciaEstruturada {
  cargo: string;
  empresa: string;
  /** Como está no currículo. Na Gupy vai no campo de data, nunca na descrição. */
  periodo: string;
  descricao: string;
  /** Só no LinkedIn: competências para associar à experiência. */
  competencias: string[];
}

export interface EstruturaLinkedin {
  plataforma: 'linkedin';
  headlines: string[];
  sobre: string;
  experiencias: ExperienciaEstruturada[];
  competencias: string[];
  destaques: string[];
  /** Marcadores `[...]` que a pessoa precisa preencher, na ordem em que aparecem. */
  pendencias: string[];
  modelo: string;
}

export interface EstruturaGupy {
  plataforma: 'gupy';
  experiencias: ExperienciaEstruturada[];
  habilidades: string[];
  apresenteSe: string;
  /** Sem vaga colada, o "Apresente-se" é para o cargo, não para uma vaga. */
  apresenteSeGenerico: boolean;
  pendencias: string[];
  modelo: string;
}

export type Estrutura = EstruturaLinkedin | EstruturaGupy;

/** O que é igual para todo mundo e por isso não passa pelo modelo. */
export const CHECKLIST: Record<Plataforma, string[]> = {
  linkedin: [
    'URL personalizada (linkedin.com/in/seu-nome), sem números aleatórios.',
    'Localização correta: recrutadores filtram por cidade.',
    'Foto atual e profissional; capa coerente com a área (opcional).',
    'Experiências vinculadas à página oficial da empresa, com tipo de vínculo e modalidade.',
    'Cargos, empresas e datas idênticos aos do currículo.',
    'Open to Work com cargos coerentes entre si. Visível só para recrutadores não garante sigilo diante do empregador atual.',
    'Alertas de vaga ativados para o cargo-alvo.',
  ],
  gupy: [
    'Revise campo por campo o que a Gupy importou do PDF: a importação erra.',
    'Datas de início e fim nos campos de data, nunca no texto da descrição.',
    'Formação com o status correto: em andamento não é concluído.',
    'Cursos livres e certificações nos campos próprios, separados da graduação.',
    'Habilidades coerentes com o que as experiências descrevem.',
    'Texto no idioma da vaga.',
    'Respostas da pré-entrevista específicas, com um exemplo concreto cada.',
  ],
};

export const AVISO_GUPY =
  'A Gupy guarda um único currículo e replica as alterações nas candidaturas ativas. Mantenha a base alinhada ao seu objetivo principal e personalize por vaga só o "Apresente-se" e as respostas.';

export interface EntradaDaEstruturacao {
  extracao: Extracao;
  plataforma: Plataforma;
  cargo: string;
  vaga: string | null;
}

const REGRAS = `REGRAS INEGOCIÁVEIS
- Nunca invente fatos: empresa, cargo, data, certificação, ferramenta, nível de idioma, liderança, número ou resultado. Se uma métrica fortaleceria o texto e NÃO está no currículo, use um marcador visível entre colchetes, como [X%], [N clientes] ou [de A para B]. Número que está no currículo vai escrito normalmente, sem colchete. Sem métrica, descreva escopo, complexidade ou consequência concreta.
- Não suba o peso do que a pessoa fez: "automatizei" não vira "liderei", "apoiei" não vira "conduzi". Não adjetive empresa nem resultado ("grande rede", "garantindo agilidade") além do que o currículo diz.
- Mantenha os cargos e empresas exatamente como estão no currículo. Cargo interno pouco claro fica com o nome oficial; a função real vai na descrição.
- Nada de repetir palavra-chave, listar termos sem contexto, copiar a vaga ou declarar ferramenta que o currículo não mostra. Competência só entra se aparece no currículo.
- Nunca inclua CPF, RG, estado civil, filhos, idade, religião ou endereço completo.
- Texto puro, sem markdown, sem emoji. Escreva no idioma da vaga; sem vaga, em português do Brasil.
- Sem clichê ("proativo", "dinâmico", "em busca de novos desafios").`;

const EXPERIENCIA = {
  type: 'object',
  properties: {
    cargo: { type: 'string' },
    empresa: { type: 'string' },
    periodo: { type: 'string' },
    descricao: { type: 'string' },
    competencias: { type: 'array', items: { type: 'string' } },
  },
  required: ['cargo', 'empresa', 'periodo', 'descricao'],
};

export const SCHEMA: Record<Plataforma, unknown> = {
  linkedin: {
    type: 'object',
    properties: {
      headlines: { type: 'array', items: { type: 'string' } },
      sobre: { type: 'string' },
      experiencias: { type: 'array', items: EXPERIENCIA },
      competencias: { type: 'array', items: { type: 'string' } },
      destaques: { type: 'array', items: { type: 'string' } },
    },
    required: ['headlines', 'sobre', 'experiencias', 'competencias', 'destaques'],
  },
  gupy: {
    type: 'object',
    properties: {
      experiencias: { type: 'array', items: EXPERIENCIA },
      habilidades: { type: 'array', items: { type: 'string' } },
      apresenteSe: { type: 'string' },
    },
    required: ['experiencias', 'habilidades', 'apresenteSe'],
  },
};

export function montarPromptDePlataforma({ extracao, plataforma, cargo, vaga }: EntradaDaEstruturacao): string {
  const curriculo = extracao.texto.slice(0, MAX_CURRICULO);
  const blocoVaga = vaga ? `\nVAGA\n${vaga.slice(0, MAX_VAGA)}\n` : '';

  if (plataforma === 'linkedin') {
    return `Você é um recrutador técnico experiente reescrevendo o perfil do LinkedIn de uma pessoa a partir do currículo dela, para o mercado brasileiro.

OBJETIVO
No LinkedIn é o recrutador que procura. A busca dele lê headline, Sobre, experiências e competências, e os resultados são personalizados: não existe posição garantida. O perfil precisa ser encontrado pelo cargo-alvo e convencer quem o abre. Excesso de palavra-chave parece spam e prejudica.

${REGRAS}

O QUE ENTREGAR
- headlines: exatamente 2 opções, cada uma com até ${MAX_HEADLINE} caracteres, no formato "[Cargo-alvo] | [Especialidade] | [Ferramentas ou métodos] | [Área ou foco]". Ex.: "Analista de Dados | SQL, Excel e Power BI | Indicadores e automação de relatórios". Só ferramentas que o currículo mostra.
- sobre: 2 a 3 parágrafos curtos, até 2.000 caracteres: (1) identidade e especialidade; (2) capacidades e provas, com 2 ou 3 resultados verificáveis do currículo; (3) direção profissional, os problemas e funções em que quer contribuir. Iniciante usa projetos, cursos e experiências transferíveis; experiente destaca escopo e resultados.
- experiencias: uma por experiência do currículo, da mais recente para a mais antiga. descricao com uma linha de contexto e de 3 a 5 tópicos iniciados por "• " (verbo de ação + atividade + ferramenta ou contexto + resultado), um por linha. competencias: até ${MAX_COMPETENCIAS_POR_EXPERIENCIA} por experiência, das que ela demonstra.
- competencias: lista priorizada para o perfil, até ${MAX_COMPETENCIAS_LINKEDIN}, ligadas ao cargo-alvo. Menos é melhor que preencher por preencher.
- destaques: de 2 a 4 sugestões concretas para a seção Destaques (estudo de caso, dashboard com dados públicos, repositório, artigo), tiradas do que o currículo mostra. Destaques não contam na busca; servem de prova a quem visita.

CARGO-ALVO
${cargo}
${blocoVaga}
CURRÍCULO
${curriculo}`;
  }

  const apresente = vaga
    ? 'apresenteSe: personalizado para a VAGA abaixo, ligando a experiência da pessoa aos requisitos dela.'
    : `apresenteSe: não há vaga; escreva para o cargo-alvo "${cargo}". A pessoa vai personalizar por vaga.`;

  return `Você é um recrutador técnico experiente preenchendo o cadastro da Gupy de uma pessoa a partir do currículo dela.

OBJETIVO
Na Gupy a pessoa se candidata, e a ordenação das candidaturas usa principalmente os campos Experiência e Habilidades, junto com os critérios da empresa. Considera funções exercidas, tempo de experiência, área, compatibilidade com a vaga e habilidades, sempre em contexto, não por palavra isolada. O cadastro precisa deixar evidente, nesses dois campos, o que a pessoa fez e com quê.

${REGRAS}

O QUE ENTREGAR
- experiencias: uma por experiência do currículo, da mais recente para a mais antiga. periodo exatamente como está no currículo. descricao em texto puro pronto para colar no campo da Gupy: contexto da empresa ou da área em uma frase, depois atividades, ferramentas e resultados, em tópicos iniciados por "• ", um por linha. NUNCA ponha datas, meses ou anos na descricao: a Gupy tem campo próprio. Freela, voluntariado e projeto entram quando forem relevantes para o cargo-alvo.
- habilidades: até ${MAX_HABILIDADES_GUPY}, priorizadas pela relevância para o cargo-alvo, misturando técnicas, ferramentas ou métodos e comportamentais. Só as que o currículo sustenta. Nomes curtos, como a Gupy mostra ("Power BI", "Gestão de stakeholders").
- ${apresente} Até 1.000 caracteres, nesta ordem: identidade (área e experiência) → compatibilidade (atividades e ferramentas relevantes) → evidência (um projeto e o resultado) → contribuição (por que esta oportunidade se conecta ao que a pessoa fez).

CARGO-ALVO
${cargo}
${blocoVaga}
CURRÍCULO
${curriculo}`;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Sem repetição (sem diferenciar caixa) e com teto: o limite da plataforma é teto, não meta. */
function lista(v: unknown, max: number): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const item of Array.isArray(v) ? v : []) {
    const t = texto(item);
    if (!t || vistos.has(t.toLowerCase())) continue;
    vistos.add(t.toLowerCase());
    saida.push(t);
    if (saida.length === max) break;
  }
  return saida;
}

/**
 * Um tópico por linha. O prompt pede, e o modelo às vezes devolve tudo numa
 * linha só (visto na primeira geração real, 29/10) — colado assim na Gupy,
 * vira um parágrafo ilegível.
 */
export function quebrarTopicos(descricao: string): string {
  return descricao.replace(/[ \t]*\n?[ \t]*•[ \t]*/g, '\n• ').replace(/^\n/, '');
}

function experiencias(v: unknown, comCompetencias: boolean): ExperienciaEstruturada[] {
  return (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [])
    .map((e) => ({
      cargo: texto(e['cargo']),
      empresa: texto(e['empresa']),
      periodo: texto(e['periodo']),
      descricao: quebrarTopicos(texto(e['descricao'])),
      competencias: comCompetencias ? lista(e['competencias'], MAX_COMPETENCIAS_POR_EXPERIENCIA) : [],
    }))
    .filter((e) => e.cargo && e.descricao);
}

/** Marcadores que o modelo deixou para a pessoa preencher, sem repetição. */
export function pendenciasDe(textos: string[]): string[] {
  const vistos = new Set<string>();
  for (const t of textos) {
    for (const m of t.matchAll(/\[[^\[\]\n]{1,60}\]/g)) vistos.add(m[0]);
  }
  return [...vistos];
}

/**
 * Valida a resposta. O texto principal (Sobre, "Apresente-se") faltando é
 * erro: devolver o resto sem ele esconderia uma resposta truncada. Experiência
 * vazia não é — currículo de estágio pode não ter nenhuma.
 */
export function interpretarEstrutura(
  bruto: string,
  plataforma: Plataforma,
  opcoes: { modelo: string; comVaga: boolean },
): Estrutura {
  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(bruto) as Record<string, unknown>;
  } catch {
    throw new RespostaInvalida('resposta do LLM não é JSON');
  }
  if (!dados || typeof dados !== 'object') throw new RespostaInvalida('resposta vazia');

  if (plataforma === 'linkedin') {
    const headlines = lista(dados['headlines'], 2);
    const sobre = texto(dados['sobre']);
    if (headlines.length === 0 || !sobre) throw new RespostaInvalida('resposta sem headline ou sem Sobre');
    const exps = experiencias(dados['experiencias'], true);
    return {
      plataforma,
      headlines,
      sobre,
      experiencias: exps,
      competencias: lista(dados['competencias'], MAX_COMPETENCIAS_LINKEDIN),
      destaques: lista(dados['destaques'], 4),
      pendencias: pendenciasDe([...headlines, sobre, ...exps.map((e) => e.descricao)]),
      modelo: opcoes.modelo,
    };
  }

  const apresenteSe = texto(dados['apresenteSe']);
  if (!apresenteSe) throw new RespostaInvalida('resposta sem "Apresente-se"');
  const exps = experiencias(dados['experiencias'], false);
  return {
    plataforma,
    experiencias: exps,
    habilidades: lista(dados['habilidades'], MAX_HABILIDADES_GUPY),
    apresenteSe,
    apresenteSeGenerico: !opcoes.comVaga,
    pendencias: pendenciasDe([apresenteSe, ...exps.map((e) => e.descricao)]),
    modelo: opcoes.modelo,
  };
}

export async function estruturarCurriculo(entrada: EntradaDaEstruturacao, provedor: Provedor): Promise<Estrutura> {
  if (entrada.extracao.sinais.semTexto) throw new CurriculoSemTexto();
  const vaga = entrada.vaga?.trim() || null;
  const bruto = await provedor.julgar(montarPromptDePlataforma({ ...entrada, vaga }), SCHEMA[entrada.plataforma]);
  return interpretarEstrutura(bruto, entrada.plataforma, { modelo: provedor.nome, comVaga: vaga !== null });
}
