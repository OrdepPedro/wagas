/**
 * Pré-filtro: a metade da classificação que custa zero.
 *
 * Existe por economia. O tier gratuito do Gemini tem teto de requisições por
 * minuto e por dia; mandar para lá página de listagem da Gupy e vaga de outra
 * família é gastar a cota com resultado previsível. O que passa daqui é o que
 * exige julgamento de verdade.
 *
 * Duas assimetrias moldam as regras:
 *
 *   - Falso negativo é irreversível. O que o pré-filtro corta não é visto por
 *     mais ninguém. Por isso toda regra aqui só corta com evidência forte, e o
 *     harness mede o recall antes de qualquer coisa.
 *
 *   - `linkedin_post` NÃO pode ser filtrado por título (achado 3 do CLAUDE.md).
 *     O `title` que a API devolve para post não é o `<title>` da página: o
 *     Google reescreve para "Fulano posted this". O pré-filtro por título nesse
 *     bloco já foi aplicado na origem, pelo `intitle:` do dork. Aplicar regex
 *     de novo aqui descartaria vaga boa.
 */
import { cargoBateNoTitulo } from './familia.ts';
import type { Candidato, Motivo } from './tipos.ts';

/** A promessa do produto: nada com mais de 7 dias entra no feed. */
export const JANELA_DIAS = 7;

export interface DecisaoPrefiltro {
  passa: boolean;
  motivo: Motivo | null;
  detalhe: string;
}

const PASSOU: DecisaoPrefiltro = { passa: true, motivo: null, detalhe: '' };

/**
 * Títulos de página de listagem da Gupy. Não são vaga: são a busca da própria
 * Gupy indexada pelo Google ("Vagas de enfermagem | Encontre oportunidades").
 *
 * Só valem para `ats_gupy`. Um post intitulado "Vagas Home Office - Product
 * Manager" é anúncio de vaga de verdade, e cairia aqui por engano.
 */
const TITULOS_DE_LISTAGEM = [
  /encontre oportunidades/i,
  /^aplique para vagas\b/i,
  /^vagas de\b/i,
  /^vagas em\b/i,
];

/**
 * Caminho de vaga na Gupy: `/jobs/12075384` e também `/job/<base64>`, que a
 * empresa usa quando a vaga vem do portal. Qualquer outro caminho no domínio é
 * home da empresa ou busca — não tem vaga única para extrair.
 */
const CAMINHO_DE_VAGA_GUPY = /^\/jobs?\//;

function ehListagemGupy(candidato: Candidato): string | null {
  for (const padrao of TITULOS_DE_LISTAGEM) {
    if (padrao.test(candidato.titulo)) return `título de página de busca da Gupy`;
  }

  // Sem URL (caso do harness, que rotula título) a regra de caminho não roda.
  if (candidato.urlCanonica === '') return null;

  let caminho: string;
  try {
    caminho = new URL(candidato.urlCanonica).pathname;
  } catch {
    return null;
  }
  if (!CAMINHO_DE_VAGA_GUPY.test(caminho)) return `caminho ${caminho} não é de vaga única`;
  return null;
}

/**
 * Idade em dias, ou `null` quando a data é desconhecida.
 *
 * Data desconhecida NÃO reprova: só a Gupy publica data estruturada no snippet,
 * e o `tbs=qdr:w` da coleta já é a garantia de frescor das outras fontes.
 * Reprovar por ausência de data mataria os dois blocos do LinkedIn inteiros.
 */
export function idadeEmDias(dataPublicacao: string | null, agora: Date): number | null {
  if (!dataPublicacao) return null;
  const ms = Date.parse(dataPublicacao);
  if (!Number.isFinite(ms)) return null;
  return (agora.getTime() - ms) / 86_400_000;
}

export function prefiltrar(
  candidato: Candidato,
  opcoes: { agora?: Date; janelaDias?: number } = {},
): DecisaoPrefiltro {
  const agora = opcoes.agora ?? new Date();
  const janela = opcoes.janelaDias ?? JANELA_DIAS;

  if (candidato.fonte === 'desconhecida') {
    return {
      passa: false,
      motivo: 'fonte_sem_extrator',
      detalhe: 'domínio fora das três fontes suportadas',
    };
  }

  if (candidato.fonte === 'ats_gupy') {
    const listagem = ehListagemGupy(candidato);
    if (listagem) return { passa: false, motivo: 'pagina_de_listagem', detalhe: listagem };
  }

  const idade = idadeEmDias(candidato.dataPublicacao, agora);
  if (idade !== null && idade > janela) {
    return {
      passa: false,
      motivo: 'fora_da_janela',
      detalhe: `publicada há ${idade.toFixed(0)} dias, teto é ${janela}`,
    };
  }

  // Achado 3: o `title` de post vem reescrito pelo Google. Filtrar por ele aqui
  // descartaria vaga boa — o `intitle:` do dork já fez esse filtro na origem.
  if (candidato.fonte === 'linkedin_post') return PASSOU;

  const casamento = cargoBateNoTitulo(candidato.cargoBusca, candidato.titulo);
  if (!casamento.bate) {
    return { passa: false, motivo: 'cargo_fora_do_titulo', detalhe: casamento.detalhe };
  }

  return PASSOU;
}
