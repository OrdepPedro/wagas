/** Origem do resultado. Vira a coluna `fonte` em raw_results e permite facetar o feed. */
export type Fonte = 'linkedin_job' | 'linkedin_post' | 'ats_gupy' | 'desconhecida';

/** Modelo de trabalho pedido na busca (nao e o modelo da vaga — isso e o classificador que decide). */
export type Modelo = 'remoto' | 'hibrido' | 'presencial' | 'qualquer';

/** De onde saiu a data de publicacao. Guardado junto com a data para nao confundir sinal com chute. */
export type OrigemData = 'gupy_snippet' | 'metatag' | 'desconhecida';

export interface Segmento {
  cargo: string;
  modelo: Modelo;
  /** Cidade/UF. `null` quando a busca e so por modelo (ex.: remoto). */
  localizacao: string | null;
}

export interface Combinacao extends Segmento {
  /** Id estavel — vai para raw_results.combo_id. Nao renomear depois de ir a producao. */
  id: string;
  fonte: Exclude<Fonte, 'desconhecida'>;
  dork: string;
  /** Restricao de data da PSE (d7, m1...). Obrigatorio em linkedin_post. */
  dateRestrict: string | null;
  /** Paginas de 10 resultados. Cada pagina = 1 query da cota. */
  paginas: number;
  ativo: boolean;
}

/** Uma unidade de consumo de cota: um combo em uma pagina. */
export interface Query {
  combo: Combinacao;
  pagina: number;
  /** start da PSE: 1, 11, 21... */
  start: number;
}
