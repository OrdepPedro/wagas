/**
 * Quadros do Greenhouse coletados (achado 36).
 *
 * O Greenhouse não tem busca por cargo e cidade: cada empresa tem um quadro, e
 * o quadro inteiro vem numa requisição. A coleta baixa todos e o filtro de cargo
 * e local fica no Postgres, que é onde a regra crítica quer que ele fique.
 *
 * `empresa` é escrito aqui porque o `company_name` da API não serve para exibir:
 * a Stone publica como "Stone - Linkedin", a Gympass como "Wellhub".
 *
 * `soBrasil` diz o que fazer com local que não dá para saber o país ("Remoto",
 * "Salvador", "Limeira"). Num quadro só brasileiro, é Brasil; num quadro
 * internacional, fica de fora, porque "Remote" ali é remoto dos EUA tanto quanto
 * do Brasil. Local confirmado fora ("Miami, FL") sai nos dois casos.
 *
 * Fora da lista, de propósito, conferido em 14/11 pelo `location.name` real:
 *   arco   é a Arco dos EUA, uma construtora, não a Arco Educação. 404 vagas, 0 no Brasil.
 *   flash  é um quadro da República Dominicana, não a Flash de benefícios.
 *   blip   2 vagas, Los Angeles e "Remote".
 */
export interface QuadroGreenhouse {
  slug: string;
  empresa: string;
  soBrasil: boolean;
}

export const QUADROS_GREENHOUSE: QuadroGreenhouse[] = [
  { slug: 'stone', empresa: 'Stone', soBrasil: true },
  { slug: 'btgpactual', empresa: 'BTG Pactual', soBrasil: true },
  { slug: 'c6bank', empresa: 'C6 Bank', soBrasil: true },
  { slug: 'inter', empresa: 'Inter', soBrasil: true },
  { slug: 'xpinc', empresa: 'XP Inc.', soBrasil: true },
  { slug: 'quintoandar', empresa: 'QuintoAndar', soBrasil: false },
  { slug: 'gympass', empresa: 'Wellhub', soBrasil: false },
  { slug: 'ebanx', empresa: 'EBANX', soBrasil: false },
  { slug: 'vtex', empresa: 'VTEX', soBrasil: false },
  { slug: 'jusbrasil', empresa: 'Jusbrasil', soBrasil: true },
  { slug: 'wildlifestudios', empresa: 'Wildlife Studios', soBrasil: true },
  { slug: 'bancopan', empresa: 'Banco PAN', soBrasil: true },
  { slug: 'rdstation', empresa: 'RD Station', soBrasil: true },
];
