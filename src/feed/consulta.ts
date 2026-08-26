/**
 * O feed, em forma de consulta.
 *
 * A regra crítica do CLAUDE.md é que busca nunca é disparada por request de
 * usuário: a coleta popula o cache e o usuário lê o cache. Este módulo é a
 * fronteira onde isso é imposto — ele traduz "cargo + cidade" em `WHERE`, e não
 * existe caminho daqui para a Serper.
 *
 * Mora em `src/` e não dentro do Next.js de propósito. A tradução usa as MESMAS
 * funções que o classificador usou para gravar (`filtroDeFamilia`,
 * `slugCidade`); se ela vivesse só no front-end, uma segunda implementação
 * acabaria discordando do dado — e o sintoma seria feed vazio sem causa
 * aparente.
 *
 * A composição vem da premissa do produto, não de preferência:
 *
 *   presencial e híbrido  ->  só na cidade do usuário
 *   remoto                ->  todo o Brasil
 *
 * Traduzido: `cidade_slug = <a dele>` OU (`modelo = remoto` E o país não é
 * comprovadamente outro).
 */
import { filtroDeFamilia } from '../classificar/familia.ts';
import { slugCidade } from '../normalize/local.ts';

/** A promessa do produto. Não existe seletor de período — ver CLAUDE.md. */
export const JANELA_DIAS = 7;

export interface PedidoDeFeed {
  cargo: string;
  cidade: string;
  janelaDias?: number;
  limite?: number;
  agora?: Date;
}

export interface ConsultaDeFeed {
  /** Query string do PostgREST, pronta para `SupabaseRest.select('jobs', …)`. */
  query: string;
  /** O que foi extraído do pedido. Vai para o log e para o estado vazio da tela. */
  cidadeSlug: string;
  dominio: string[];
  classes: string[];
  desde: string;
}

/**
 * Colunas que o feed exibe. Lista explícita em vez de `*`: a tabela guarda
 * campos de contabilidade da classificação que não têm por que trafegar.
 */
export const COLUNAS_DO_FEED = [
  'id',
  'empresa',
  'cargo',
  'senioridade',
  'modelo',
  'localizacao',
  'cidade_slug',
  'uf',
  'pais_br',
  'url',
  'fonte',
  'descricao',
  'data_publicacao',
  'data_publicacao_origem',
  'data_referencia',
  'local_avaliado',
  'confianca',
].join(',');

/**
 * Monta a consulta.
 *
 * Cargo, em duas condições que são a tradução literal de `cargoBateNoTitulo`:
 *
 *   1. `familia_tokens` contém todo o domínio do cargo buscado. É a condição
 *      forte — sem `product` no título, nada de Product Manager.
 *   2. `familia_classes` cruza com as classes do cargo buscado, OU está vazia.
 *      Vazia significa título sem função reconhecida ("Enfermeiro"), e cortar
 *      ali derrubaria vaga demais — mesma decisão do pré-filtro.
 *
 * A condição 2 só entra quando o cargo digitado TEM função. "Enfermeiro" não
 * tem, e aí a regra degrada para "a palavra precisa estar no título", que é
 * exatamente o certo nesse caso.
 */
export function consultaDeFeed(pedido: PedidoDeFeed): ConsultaDeFeed {
  const { dominio, classes } = filtroDeFamilia(pedido.cargo);
  const cidadeSlug = slugCidade(pedido.cidade);

  const agora = pedido.agora ?? new Date();
  const janela = pedido.janelaDias ?? JANELA_DIAS;
  const desde = new Date(agora.getTime() - janela * 24 * 60 * 60 * 1000).toISOString();

  const partes = [
    `select=${COLUNAS_DO_FEED}`,
    'ativo=is.true',
    `data_referencia=gte.${desde}`,
  ];

  if (dominio.length > 0) partes.push(`familia_tokens=cs.${lista(dominio)}`);

  // Os dois grupos de OR vão dentro de um único `and=(…)`. O PostgREST ANDeia
  // parâmetros de topo, mas repetir a chave `or` duas vezes na mesma URL é
  // ambíguo — a árvore explícita não é.
  const grupos = [
    // Composição de local. `pais_br.not.is.false` deixa passar Brasil
    // confirmado E não-sei; barra só o que foi identificado como de fora — é
    // assim que a vaga remota da França sai do feed sem levar junto as vagas
    // brasileiras cuja localização o anúncio não qualificou.
    `or(cidade_slug.eq.${cidadeSlug},and(modelo.eq.remoto,pais_br.not.is.false))`,
  ];
  if (classes.length > 0) {
    grupos.unshift(`or(familia_classes.eq.{},familia_classes.ov.${lista(classes)})`);
  }
  partes.push(`and=(${grupos.join(',')})`);

  partes.push('order=data_referencia.desc');
  partes.push(`limit=${pedido.limite ?? 100}`);

  return { query: partes.join('&'), cidadeSlug, dominio, classes, desde };
}

/** Array literal do PostgREST: `{a,b}`. Item com vírgula ou aspas vai entre aspas. */
function lista(itens: string[]): string {
  const partes = itens.map((item) =>
    /[,"{}\\\s]/.test(item) ? `"${item.replace(/(["\\])/g, '\\$1')}"` : item,
  );
  return `{${partes.join(',')}}`;
}
