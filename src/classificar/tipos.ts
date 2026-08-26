/** Tipos do Passo 3. O que entra no classificador e o que sai dele. */
import type { Fonte } from '../tipos.ts';

/**
 * Uma linha de `raw_results` pronta para julgamento.
 *
 * `snippet` está aqui, mas é SINAL FRACO: a página de uma vaga do LinkedIn traz
 * a barra lateral de "vagas similares", então o snippet pode descrever outra
 * vaga, de outra empresa (achado 1 do CLAUDE.md). Nada que decida empresa pode
 * sair dele sozinho.
 */
export interface Candidato {
  /** `raw_results.id`. Ausente quando o candidato vem do harness. */
  id: number | null;
  fonte: Fonte;
  fonteId: string | null;
  urlCanonica: string;
  titulo: string;
  snippet: string;
  cargoBusca: string;
  localizacaoBusca: string | null;
  dataPublicacao: string | null;
  /** Procedência da data. Data sem procedência não é verificável no feed. */
  dataPublicacaoOrigem?: string | null;
}

export type Veredito = 'aprovado' | 'rejeitado' | 'erro';

/**
 * Por que o candidato caiu. O motivo é gravado em `raw_results` para o harness
 * poder medir cada regra separadamente sobre dado de produção — sem isso, a
 * única informação seria "sobrou X de Y", que não diz qual regra está errando.
 */
export type Motivo =
  // decididos pelo pré-filtro, de graça
  | 'fonte_sem_extrator'
  | 'pagina_de_listagem'
  | 'fora_da_janela'
  | 'cargo_fora_do_titulo'
  // decididos pelo LLM
  | 'nao_e_vaga'
  | 'cargo_de_outra_familia'
  | 'local_nao_serve'
  | 'sem_empresa'
  | 'confianca_baixa'
  // falha de infraestrutura, não de conteúdo: o candidato volta na próxima rodada
  | 'erro_do_classificador';

/** Onde a decisão foi tomada. Separa custo de token de custo zero. */
export type Estagio = 'prefiltro' | 'llm';

export interface Extracao {
  empresa: string | null;
  cargo: string | null;
  senioridade: string | null;
  modelo: 'remoto' | 'hibrido' | 'presencial' | null;
  localizacao: string | null;
}

export interface Decisao {
  candidato: Candidato;
  veredito: Veredito;
  motivo: Motivo | null;
  estagio: Estagio;
  /** Texto curto do julgamento. Para depurar, não para o usuário final. */
  detalhe: string;
  confianca: number | null;
  extracao: Extracao | null;
  /** Identificação do que decidiu: `prefiltro/v1`, `gemini/gemini-2.5-flash-lite`. */
  classificador: string;
}
