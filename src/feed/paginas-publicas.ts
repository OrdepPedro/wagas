/**
 * Páginas públicas por cargo × cidade (`/vagas-de/<cargo>/<cidade>`), para o
 * Google.
 *
 * Agregador de vaga ganha busca com uma página por "vagas de X em Y"; o wagas
 * tinha uma só, a landing. Estas páginas são o mesmo feed, lido do cache, num
 * endereço que o robô consegue abrir sem sessão.
 *
 * O conjunto é FECHADO de propósito: os pares da pré-carga, que são os que a
 * coleta diária mantém cheios, mais a versão remota de cada cargo. Aceitar
 * qualquer slug na URL abriria um espaço infinito de páginas finas para o robô
 * rastrear, e página fina em massa é o que o Google rebaixa.
 *
 * Nenhuma página destas dispara coleta. A regra crítica vale igual: o robô lê
 * o cache, nunca puxa fonte externa.
 */
import { CARGOS_PRE_CARGA, CIDADES_PRE_CARGA, type CidadeAlvo } from '../config/pre-carga.ts';
import { slugCidade } from '../normalize/local.ts';

/** Segmento de URL do recorte "só remoto". Não colide com nenhuma cidade. */
export const SLUG_REMOTO = 'remoto';

export interface PaginaPublica {
  cargo: string;
  cargoSlug: string;
  /** `null` = só remoto, Brasil inteiro. */
  cidade: CidadeAlvo | null;
  cidadeSlug: string;
}

/** Mesma normalização do slug de cidade: minúsculas, sem acento, hífen. */
export const slugDoCargo = (cargo: string): string => slugCidade(cargo);

export const PAGINAS_PUBLICAS: PaginaPublica[] = CARGOS_PRE_CARGA.flatMap((cargo) => [
  ...CIDADES_PRE_CARGA.map((cidade) => ({
    cargo,
    cargoSlug: slugDoCargo(cargo),
    cidade,
    cidadeSlug: slugCidade(cidade.nome),
  })),
  { cargo, cargoSlug: slugDoCargo(cargo), cidade: null, cidadeSlug: SLUG_REMOTO },
]);

export function paginaPublica(cargoSlug: string, cidadeSlug: string): PaginaPublica | null {
  return PAGINAS_PUBLICAS.find((p) => p.cargoSlug === cargoSlug && p.cidadeSlug === cidadeSlug) ?? null;
}

export const caminhoDaPagina = (p: Pick<PaginaPublica, 'cargoSlug' | 'cidadeSlug'>): string =>
  `/vagas-de/${p.cargoSlug}/${p.cidadeSlug}`;

/** "Vagas de Vendedor em Curitiba" / "Vagas remotas de Vendedor". */
export function tituloDaPagina(p: PaginaPublica): string {
  return p.cidade ? `Vagas de ${p.cargo} em ${p.cidade.nome}` : `Vagas remotas de ${p.cargo}`;
}
