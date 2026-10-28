/**
 * Tipos do medidor de currículo.
 *
 * O medidor é a peça commodity de propósito (decisão do Pedro em 28/10): mede
 * o currículo contra boas práticas e, opcionalmente, contra uma vaga colada.
 * Não usa o feed ainda. O encaixe vaga do feed × currículo é o passo seguinte,
 * se este validar.
 */

export type TipoEntrada = 'pdf' | 'docx' | 'texto';

/**
 * O que o ARQUIVO diz sobre si mesmo, lido pelo código.
 *
 * O LLM só recebe texto: não vê coluna, tabela, imagem nem cabeçalho do
 * editor. Por isso o critério A (formato e extração) sai destes sinais, não do
 * modelo — pedir ao modelo que julgue layout a partir de texto seria pedir que
 * adivinhasse.
 */
export interface SinaisDoArquivo {
  tipo: TipoEntrada;
  paginas: number | null;
  caracteres: number;
  /** Quase nenhum texto para o número de páginas: imagem escaneada. */
  semTexto: boolean;
  colunas: boolean;
  tabelas: number;
  caixasDeTexto: number;
  imagens: number;
  /** E-mail ou telefone aparece no cabeçalho/rodapé do editor e não no corpo. */
  contatoSoNoCabecalho: boolean;
}

export interface Extracao {
  texto: string;
  sinais: SinaisDoArquivo;
}

export type IdCriterio = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface NotaDeCriterio {
  id: IdCriterio;
  nome: string;
  pontos: number;
  maximo: number;
  observacao: string;
  /** Falso quando não deu para avaliar (critério A em texto colado); fica fora da soma. */
  avaliado: boolean;
}

export type StatusRequisito = 'demonstrado' | 'sem_contexto' | 'ausente';

export interface Requisito {
  termo: string;
  essencial: boolean;
  status: StatusRequisito;
  /** Como o termo aparece no currículo, quando aparece com outra grafia. */
  grafiaNoCurriculo: string | null;
}

export type TipoAlerta = 'eliminatorio' | 'extracao' | 'lacuna' | 'privacidade';

export interface Alerta {
  tipo: TipoAlerta;
  texto: string;
}

export type Faixa = 'Muito bom' | 'Bom, com ajustes pontuais' | 'Lacunas relevantes' | 'Recomenda-se reestruturação';

export interface ResultadoDaMedicao {
  /** 0–100, normalizado sobre os critérios avaliados. */
  nota: number;
  faixa: Faixa;
  /** Sem vaga colada, o Pilar 2 é medido contra o cargo e a nota é estimada. */
  estimada: boolean;
  criterios: NotaDeCriterio[];
  requisitos: Requisito[];
  alertas: Alerta[];
  melhorias: string[];
  modelo: string;
}
