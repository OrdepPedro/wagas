/**
 * Orquestra a classificação: pré-filtro barato, depois LLM no que sobrou.
 *
 * A ordem não é detalhe de implementação — é o desenho de custo do Passo 3. O
 * pré-filtro derruba página de listagem, vaga fora da janela e cargo de outra
 * família sem gastar um token; o LLM só vê o que exige julgamento. Quanto cada
 * estágio derruba, e quanto erra ao derrubar, é o que o harness mede.
 *
 * Este módulo não conhece banco nem HTTP: recebe candidatos e um provedor,
 * devolve decisões. É o que permite rodar o harness sobre um arquivo rotulado
 * com exatamente o mesmo código que roda em produção — harness que testa outro
 * caminho não mede nada.
 */
import { log } from '../logger.ts';
import { chaveDedupVaga, normalizarCargo } from '../dedupe.ts';
import { senioridadeDoTitulo } from './familia.ts';
import { modeloDoTexto } from '../normalize/local.ts';
import { LlmIndisponivel, type Provedor } from './llm.ts';
import { prefiltrar } from './prefiltro.ts';
import { interpretarResposta, montarPrompt, SCHEMA_RESPOSTA, type Julgamento } from './prompt.ts';
import type { Candidato, Decisao, Extracao, Motivo } from './tipos.ts';

export interface OpcoesClassificacao {
  /** Candidatos por chamada. Lote grande economiza requisição; grande demais estoura o contexto. */
  tamanhoDoLote?: number;
  /** Abaixo disto a vaga não entra no feed, mesmo que o modelo diga que bate. */
  confiancaMinima?: number;
  agora?: Date;
  janelaDias?: number;
}

export const PADROES = {
  tamanhoDoLote: 8,
  confiancaMinima: 0.6,
} as const;

function rejeitadoNoPrefiltro(candidato: Candidato, motivo: Motivo, detalhe: string): Decisao {
  return {
    candidato,
    veredito: 'rejeitado',
    motivo,
    estagio: 'prefiltro',
    detalhe,
    confianca: null,
    extracao: null,
    classificador: 'prefiltro/v1',
  };
}

function erro(candidato: Candidato, detalhe: string, classificador: string): Decisao {
  return {
    candidato,
    veredito: 'erro',
    motivo: 'erro_do_classificador',
    estagio: 'llm',
    detalhe,
    confianca: null,
    extracao: null,
    classificador,
  };
}

/**
 * Empresa a partir do subdomínio da Gupy, quando o modelo não achou nome.
 *
 * Serve para exibição, NÃO resolve dedup entre fontes: `carreirasomie` não casa
 * com "Omie" vinda de um post. A dedup semântica (pgvector) é que fecha esse
 * caso — está registrada como requisito de lançamento, não foi feita aqui.
 */
export function empresaDoSubdominioGupy(urlCanonica: string): string | null {
  try {
    const host = new URL(urlCanonica).hostname;
    const sub = host.replace(/\.gupy\.io$/, '');
    if (sub === host || sub === '' || sub === 'portal' || sub === 'www') return null;
    return sub;
  } catch {
    return null;
  }
}

/**
 * Os campos de texto em que se pode confiar, por fonte. É a mesma leitura que o
 * prompt dá ao modelo, aplicada às regras determinísticas:
 *
 *   linkedin_job   título confiável; snippet contaminado pela barra lateral de
 *                  "vagas similares" (achado 1), então fica de fora.
 *   linkedin_post  título reescrito pelo Google ("Publicação de Fulano"); o
 *                  sinal está no snippet, que é o começo do texto do post.
 *   ats_gupy       os dois servem.
 */
function textoConfiavel(candidato: Candidato): string[] {
  if (candidato.fonte === 'linkedin_job') return [candidato.titulo];
  if (candidato.fonte === 'linkedin_post') return [candidato.snippet];
  return [candidato.titulo, candidato.snippet];
}

function completarExtracao(candidato: Candidato, extraido: Extracao): Extracao {
  return {
    empresa:
      extraido.empresa ??
      (candidato.fonte === 'ats_gupy' ? empresaDoSubdominioGupy(candidato.urlCanonica) : null),
    cargo: extraido.cargo ?? (candidato.fonte === 'linkedin_post' ? null : candidato.titulo),
    senioridade: extraido.senioridade ?? senioridadeDoTitulo(candidato.titulo),
    // O modelo é a metade da composição do feed (presencial/híbrido na cidade +
    // remoto no Brasil) e o modelo de linguagem deixou 58% das linhas sem ele.
    // O termo costuma estar escrito no anúncio — "Vaga Home Office:",
    // "[100% remoto]", "(Híbrida em BH)" — então vale a leitura determinística
    // antes de desistir. Só entra quando o LLM não respondeu: julgamento vence
    // regex quando os dois existem.
    modelo: extraido.modelo ?? modeloDoTexto(...textoConfiavel(candidato)),
    localizacao: extraido.localizacao ?? candidato.localizacaoBusca,
  };
}

function decidirComJulgamento(
  candidato: Candidato,
  julgamento: Julgamento,
  classificador: string,
  confiancaMinima: number,
): Decisao {
  const base = {
    candidato,
    estagio: 'llm' as const,
    detalhe: julgamento.motivo,
    confianca: julgamento.confianca,
    classificador,
  };

  if (!julgamento.ehVaga) {
    return { ...base, veredito: 'rejeitado', motivo: 'nao_e_vaga', extracao: null };
  }
  if (!julgamento.cargoBate) {
    return { ...base, veredito: 'rejeitado', motivo: 'cargo_de_outra_familia', extracao: null };
  }
  // Promessa do produto: presencial e híbrido só na cidade buscada, remoto vale
  // o Brasil inteiro. O portão só fecha com evidência — local não mencionado
  // passa, senão a maioria das vagas cairia por silêncio do título.
  if (!julgamento.localBate) {
    return { ...base, veredito: 'rejeitado', motivo: 'local_nao_serve', extracao: null };
  }
  if (julgamento.confianca < confiancaMinima) {
    return {
      ...base,
      veredito: 'rejeitado',
      motivo: 'confianca_baixa',
      detalhe: `${julgamento.motivo} (confiança ${julgamento.confianca.toFixed(2)})`,
      extracao: null,
    };
  }

  return {
    ...base,
    veredito: 'aprovado',
    motivo: null,
    extracao: completarExtracao(candidato, julgamento.extracao),
  };
}

/**
 * Classifica um lote de candidatos.
 *
 * Sem provedor (`null`), roda só o pré-filtro e marca o que passou como erro de
 * classificação — nada é aprovado sem julgamento. É o modo do harness quando
 * não há chave de LLM: dá para medir o pré-filtro isolado sem inventar
 * aprovação nenhuma.
 */
export async function classificar(
  candidatos: Candidato[],
  provedor: Provedor | null,
  opcoes: OpcoesClassificacao = {},
): Promise<Decisao[]> {
  const tamanhoDoLote = opcoes.tamanhoDoLote ?? PADROES.tamanhoDoLote;
  const confiancaMinima = opcoes.confiancaMinima ?? PADROES.confiancaMinima;

  const decisoes = new Map<Candidato, Decisao>();
  const paraOLlm: Candidato[] = [];

  for (const candidato of candidatos) {
    const { passa, motivo, detalhe } = prefiltrar(candidato, {
      agora: opcoes.agora,
      janelaDias: opcoes.janelaDias,
    });
    if (!passa && motivo) decisoes.set(candidato, rejeitadoNoPrefiltro(candidato, motivo, detalhe));
    else paraOLlm.push(candidato);
  }

  log.info('pré-filtro concluído', {
    entraram: candidatos.length,
    rejeitados: candidatos.length - paraOLlm.length,
    seguem: paraOLlm.length,
  });

  if (!provedor) {
    for (const candidato of paraOLlm) {
      decisoes.set(candidato, erro(candidato, 'sem provedor de LLM configurado', 'nenhum'));
    }
    return candidatos.map((c) => decisoes.get(c)!);
  }

  for (let i = 0; i < paraOLlm.length; i += tamanhoDoLote) {
    const lote = paraOLlm.slice(i, i + tamanhoDoLote);

    let bruto: string;
    try {
      bruto = await provedor.julgar(montarPrompt(lote), SCHEMA_RESPOSTA);
    } catch (falha) {
      // Cota estourada não é defeito do lote: para a rodada em vez de marcar
      // como erro tudo que ainda não foi visto. O que ficou pendente volta.
      const fatal = falha instanceof LlmIndisponivel;
      log.error('lote não classificado', { erro: String(falha), restantes: paraOLlm.length - i });
      for (const candidato of paraOLlm.slice(i)) {
        decisoes.set(candidato, erro(candidato, String(falha), provedor.nome));
      }
      if (fatal) break;
      continue;
    }

    const julgamentos = new Map(interpretarResposta(bruto, lote.length).map((j) => [j.id, j]));

    lote.forEach((candidato, indice) => {
      const julgamento = julgamentos.get(indice);
      if (!julgamento) {
        decisoes.set(candidato, erro(candidato, 'modelo não devolveu julgamento', provedor.nome));
        return;
      }
      decisoes.set(
        candidato,
        decidirComJulgamento(candidato, julgamento, provedor.nome, confiancaMinima),
      );
    });
  }

  return candidatos.map(
    (c) => decisoes.get(c) ?? erro(c, 'lote interrompido antes deste item', provedor.nome),
  );
}

/**
 * Chave de dedup da vaga aprovada.
 *
 * Sem empresa identificada não dá para usar `empresa + cargo`: a chave
 * colapsaria todas as vagas de mesmo cargo numa só e o feed perderia vaga boa.
 * Nesse caso a chave cai para o id nativo da fonte — não deduplica entre
 * fontes, mas também não funde o que é diferente. Preferir perder uma fusão a
 * fundir errado é a mesma regra de `normalizarEmpresa`.
 */
export function chaveDaDecisao(decisao: Decisao): string {
  const { candidato, extracao } = decisao;
  const cargo = extracao?.cargo ?? candidato.titulo;

  if (extracao?.empresa) return chaveDedupVaga(extracao.empresa, cargo);

  const id = candidato.fonteId ?? candidato.urlCanonica;
  return `sem-empresa:${candidato.fonte}:${id}|${normalizarCargo(cargo)}`;
}

export interface Resumo {
  total: number;
  aprovados: number;
  rejeitadosNoPrefiltro: number;
  rejeitadosNoLlm: number;
  erros: number;
  porMotivo: Record<string, number>;
}

export function resumir(decisoes: Decisao[]): Resumo {
  const resumo: Resumo = {
    total: decisoes.length,
    aprovados: 0,
    rejeitadosNoPrefiltro: 0,
    rejeitadosNoLlm: 0,
    erros: 0,
    porMotivo: {},
  };

  for (const d of decisoes) {
    if (d.motivo) resumo.porMotivo[d.motivo] = (resumo.porMotivo[d.motivo] ?? 0) + 1;
    if (d.veredito === 'aprovado') resumo.aprovados++;
    else if (d.veredito === 'erro') resumo.erros++;
    else if (d.estagio === 'prefiltro') resumo.rejeitadosNoPrefiltro++;
    else resumo.rejeitadosNoLlm++;
  }

  return resumo;
}
