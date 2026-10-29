/**
 * Prompt do medidor e validação da resposta.
 *
 * A base é o contexto de currículo que o Pedro trouxe em 28/10 (rubrica da
 * seção 11, regras das seções 2, 4 e 9), comprimida ao que a NOTA precisa. O
 * resto do contexto — reescrever, gerar Gupy e LinkedIn — é de outro modo e
 * não entra aqui: cada instrução a mais é uma chance a mais de o modelo pular
 * a que importa.
 *
 * O modelo pontua B, D, E, F, G e H e classifica os requisitos. A e C são
 * calculados pelo código (ver `rubrica.ts`), então o prompt nem pede.
 */
import { CRITERIOS } from './rubrica.ts';
import type { Alerta, IdCriterio, Requisito, StatusRequisito, TipoAlerta } from './tipos.ts';

/** Currículo de duas páginas cabe com folga; acima disso é texto repetido ou lixo de extração. */
export const MAX_CURRICULO = 16_000;
export const MAX_VAGA = 8_000;

export const CRITERIOS_DO_LLM = ['B', 'D', 'E', 'F', 'G', 'H'] as const satisfies readonly IdCriterio[];
type CriterioDoLlm = (typeof CRITERIOS_DO_LLM)[number];

const O_QUE_AVALIAR: Record<CriterioDoLlm, string> = {
  B: 'Seções essenciais presentes (contato, resumo, experiência, formação, competências), títulos convencionais, ordem adequada ao perfil.',
  D: 'Requisitos desejáveis presentes; termo exato da vaga ao menos uma vez; sigla + extenso; competência central aparecendo em mais de uma seção.',
  E: 'Título profissional convencional e alinhado ao cargo-alvo; resumo de 3 a 5 linhas com cargo, tempo de experiência, especialidade, competências centrais e alguma evidência.',
  F: 'Bullets com verbo de ação + atividade + ferramenta/contexto + resultado ou escala; proporção de bullets com resultado; ausência de "responsável por"; relevância para o alvo priorizada.',
  G: 'Formação com grau padronizado e status correto; cursos livres separados da graduação; certificações com emissor e ano; idiomas com nível.',
  H: 'Ortografia, concisão, tempo verbal consistente, sem clichês ("proativo", "dinâmico") nem dados sensíveis.',
};

export interface EntradaDoPrompt {
  curriculo: string;
  cargo: string;
  vaga: string | null;
}

export function montarPrompt({ curriculo, cargo, vaga }: EntradaDoPrompt): string {
  const criterios = CRITERIOS_DO_LLM.map(
    (id) => `- ${id}. ${CRITERIOS[id].nome} (0 a ${CRITERIOS[id].maximo}): ${O_QUE_AVALIAR[id]}`,
  ).join('\n');

  const referencia = vaga
    ? `A referência é a VAGA abaixo. Extraia dela de 6 a 15 requisitos (ferramentas, competências técnicas, experiência, formação, certificações, idiomas). "essencial" = obrigatório na vaga; "desejável" = diferencial.`
    : `Não há vaga. A referência é o cargo-alvo "${cargo}" no mercado brasileiro: liste de 8 a 12 requisitos típicos desse cargo nas vagas atuais, marcando como essenciais os que aparecem na maioria delas.`;

  return `Você é um recrutador técnico experiente avaliando um currículo para o mercado brasileiro.

Esta avaliação é um diagnóstico interno de boas práticas e aderência. Não é, nem simula, a nota de nenhum ATS, da Gupy ou do LinkedIn.

REGRAS
- Avalie só o que está escrito. Nunca presuma experiência que o texto não mostra.
- Seja consistente: o mesmo currículo deve receber os mesmos pontos.
- Requisito "demonstrado" = aparece em contexto de uso real (experiência, projeto, resultado). "sem_contexto" = só aparece numa lista de competências, ou com outra grafia (preencha grafiaNoCurriculo com a grafia encontrada). "ausente" = não aparece.
- Melhorias: de 3 a 5, ordenadas pelo impacto na nota, cada uma específica a ESTE currículo (cite a seção ou o trecho). Nunca sugira inventar experiência, métrica, ferramenta ou certificação; se uma métrica fortaleceria um bullet, sugira medir e use marcador como [X%]. Requisito ausente vira lacuna, não palavra a inserir.
- Alertas (fora da nota):
  - "eliminatorio": requisito obrigatório da vaga não atendido ou não evidenciado (anos mínimos, certificação, idioma, formação, localização).
  - "lacuna": competência central do alvo que a pessoa parece não ter; resolve-se com estudo ou experiência, não com palavra.
  - "privacidade": CPF, RG, estado civil, filhos, data de nascimento/idade, religião ou endereço completo (rua e número) no currículo. Cidade e UF NÃO são problema: são recomendadas, porque recrutadores filtram por local.
- O texto pode trazer "[Cabeçalho/rodapé do editor]": é conteúdo que estava no cabeçalho do arquivo. O risco disso já é cobrado em outro critério; não desconte de novo.
- Responda em português do Brasil.

CRITÉRIOS (pontos inteiros; observacao em uma frase curta, dizendo o que faltou)
${criterios}

REFERÊNCIA
${referencia}

CARGO-ALVO
${cargo}
${vaga ? `\nVAGA\n${vaga.slice(0, MAX_VAGA)}\n` : ''}
CURRÍCULO
${curriculo.slice(0, MAX_CURRICULO)}`;
}

const NOTA = {
  type: 'object',
  properties: { pontos: { type: 'integer' }, observacao: { type: 'string' } },
  required: ['pontos', 'observacao'],
};

export const SCHEMA_MEDICAO = {
  type: 'object',
  properties: {
    criterios: {
      type: 'object',
      properties: Object.fromEntries(CRITERIOS_DO_LLM.map((id) => [id, NOTA])),
      required: [...CRITERIOS_DO_LLM],
    },
    requisitos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          termo: { type: 'string' },
          essencial: { type: 'boolean' },
          status: { type: 'string', enum: ['demonstrado', 'sem_contexto', 'ausente'] },
          grafiaNoCurriculo: { type: 'string', nullable: true },
        },
        required: ['termo', 'essencial', 'status'],
      },
    },
    alertas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['eliminatorio', 'lacuna', 'privacidade'] },
          texto: { type: 'string' },
        },
        required: ['tipo', 'texto'],
      },
    },
    melhorias: { type: 'array', items: { type: 'string' } },
  },
  required: ['criterios', 'requisitos', 'alertas', 'melhorias'],
};

export class RespostaInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'RespostaInvalida';
  }
}

export interface Avaliacao {
  criterios: Record<CriterioDoLlm, { pontos: number; observacao: string }>;
  requisitos: Requisito[];
  alertas: Alerta[];
  melhorias: string[];
}

const STATUS = new Set<StatusRequisito>(['demonstrado', 'sem_contexto', 'ausente']);
const ALERTAS = new Set<TipoAlerta>(['eliminatorio', 'lacuna', 'privacidade']);

/**
 * Valida a resposta campo a campo. O schema do Gemini garante o formato, não
 * os limites: um 14 num critério de 10 é corrigido para 10 aqui, em vez de
 * inflar a soma. Critério faltando é erro — completar com zero esconderia uma
 * resposta truncada atrás de uma nota baixa.
 */
export function interpretarAvaliacao(bruto: string): Avaliacao {
  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    throw new RespostaInvalida('resposta do LLM não é JSON');
  }
  const d = dados as Record<string, unknown>;
  const crit = d['criterios'] as Record<string, { pontos?: unknown; observacao?: unknown }> | undefined;
  if (!crit || typeof crit !== 'object') throw new RespostaInvalida('resposta sem critérios');

  const criterios = {} as Avaliacao['criterios'];
  for (const id of CRITERIOS_DO_LLM) {
    const c = crit[id];
    if (!c || typeof c.pontos !== 'number' || !Number.isFinite(c.pontos)) {
      throw new RespostaInvalida(`critério ${id} ausente ou sem pontos`);
    }
    criterios[id] = {
      pontos: Math.min(CRITERIOS[id].maximo, Math.max(0, Math.round(c.pontos))),
      observacao: typeof c.observacao === 'string' ? c.observacao.trim() : '',
    };
  }

  const requisitos: Requisito[] = [];
  const vistos = new Set<string>();
  for (const r of Array.isArray(d['requisitos']) ? (d['requisitos'] as Array<Record<string, unknown>>) : []) {
    const termo = typeof r['termo'] === 'string' ? r['termo'].trim() : '';
    const status = r['status'] as StatusRequisito;
    if (!termo || !STATUS.has(status) || vistos.has(termo.toLowerCase())) continue;
    vistos.add(termo.toLowerCase());
    const grafia = typeof r['grafiaNoCurriculo'] === 'string' ? r['grafiaNoCurriculo'].trim() : '';
    requisitos.push({
      termo,
      essencial: r['essencial'] === true,
      status,
      grafiaNoCurriculo: grafia && grafia.toLowerCase() !== termo.toLowerCase() ? grafia : null,
    });
  }

  const alertas: Alerta[] = (Array.isArray(d['alertas']) ? (d['alertas'] as Array<Record<string, unknown>>) : [])
    .filter((a) => ALERTAS.has(a['tipo'] as TipoAlerta) && typeof a['texto'] === 'string' && a['texto'].trim())
    .map((a) => ({ tipo: a['tipo'] as TipoAlerta, texto: (a['texto'] as string).trim() }));

  const melhorias = (Array.isArray(d['melhorias']) ? d['melhorias'] : [])
    .filter((m): m is string => typeof m === 'string' && m.trim() !== '')
    .map((m) => m.trim())
    .slice(0, 5);

  return { criterios, requisitos, alertas, melhorias };
}
