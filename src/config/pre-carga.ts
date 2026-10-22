/**
 * Pares coletados todo dia mesmo sem ninguém ter pedido — para que a PRIMEIRA
 * busca de quem chega pela internet já encontre o cache cheio.
 *
 * É escolha de produto, não medida: cargos de volume alto e variados (não só
 * tech, que é o viés do acervo antigo) × as maiores capitais. Quando houver uso
 * real, a tabela `buscas` diz quais pares importam, e esta lista deve encolher
 * para dar lugar a eles — a coleta diária já soma os dois.
 *
 * Custo: a Gupy é uma chamada por par (segundos). O InfoJobs leva de 1 a 5
 * minutos por par, a uma requisição por segundo. 10 × 5 = 50 pares cabem numa
 * madrugada do Actions (teto de 6h por job).
 *
 * O nome da cidade vai com acento, como a Gupy exige: "sao paulo" devolve zero.
 * A UF vai junto porque o InfoJobs sem ela busca o estado ou o Brasil inteiro.
 */

export interface CidadeAlvo {
  nome: string;
  uf: string;
}

export const CARGOS_PRE_CARGA = [
  'Auxiliar Administrativo',
  'Assistente Administrativo',
  'Vendedor',
  'Atendente',
  'Recepcionista',
  'Enfermeiro',
  'Técnico de Enfermagem',
  'Motorista',
  'Analista de Dados',
  'Desenvolvedor',
];

export const CIDADES_PRE_CARGA: CidadeAlvo[] = [
  { nome: 'São Paulo', uf: 'SP' },
  { nome: 'Rio de Janeiro', uf: 'RJ' },
  { nome: 'Belo Horizonte', uf: 'MG' },
  { nome: 'Curitiba', uf: 'PR' },
  { nome: 'Porto Alegre', uf: 'RS' },
];
