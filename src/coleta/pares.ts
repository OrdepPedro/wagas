/**
 * Quais pares cargo × cidade a coleta diária visita.
 *
 * Duas origens, somadas: a pré-carga (`config/pre-carga.ts`), que existe para a
 * primeira busca de quem chega não cair em cache vazio, e a demanda real
 * (`buscas`), ordenada por PESSOAS distintas — que é como o custo escala
 * (pares, não usuários) e como a fila de priorização já era ordenada.
 *
 * Demanda velha sai sozinha: só conta busca dos últimos `diasDeDemanda`. Sem
 * isso a lista só cresceria, e um par pedido uma vez em agosto seria coletado
 * todo dia para sempre.
 */
import { normalizarCargo } from '../dedupe.ts';
import { slugCidade } from '../normalize/local.ts';
import type { CidadeAlvo } from '../config/pre-carga.ts';

export interface Par {
  cargo: string;
  /** Nome como a Gupy exige: com acento. */
  cidade: string;
  cidadeSlug: string;
  /** Null quando não se sabe — o InfoJobs pula o par, a Gupy não precisa. */
  uf: string | null;
  origem: 'pre_carga' | 'demanda';
  /** Pessoas distintas que pediram. Zero na pré-carga. */
  pessoas: number;
}

export interface BuscaRegistrada {
  user_id: string;
  cargo: string;
  cidade: string;
  cidade_slug: string;
  criado_em: string;
}

export function chaveDoPar(cargo: string, cidadeSlug: string): string {
  return `${normalizarCargo(cargo)}|${cidadeSlug}`;
}

export function montarPares(opts: {
  cargos: string[];
  cidades: CidadeAlvo[];
  buscas: BuscaRegistrada[];
  /** UF mais frequente por `cidade_slug`, tirada do que já está em `jobs`. */
  ufPorSlug: Map<string, string>;
  agora: Date;
  diasDeDemanda?: number;
  maxDemanda?: number;
}): Par[] {
  const corte = opts.agora.getTime() - (opts.diasDeDemanda ?? 30) * 864e5;
  const ufs = new Map(opts.ufPorSlug);
  const pares = new Map<string, Par>();

  for (const cidade of opts.cidades) {
    const slug = slugCidade(cidade.nome);
    ufs.set(slug, cidade.uf); // a pré-carga é a fonte mais confiável de UF
    for (const cargo of opts.cargos) {
      pares.set(chaveDoPar(cargo, slug), {
        cargo, cidade: cidade.nome, cidadeSlug: slug, uf: cidade.uf, origem: 'pre_carga', pessoas: 0,
      });
    }
  }

  // Demanda: agrupa por par, conta pessoas distintas, guarda a grafia mais recente.
  const demanda = new Map<string, { busca: BuscaRegistrada; pessoas: Set<string> }>();
  for (const b of opts.buscas) {
    if (!b.cargo?.trim() || !b.cidade?.trim() || Date.parse(b.criado_em) < corte) continue;
    const chave = chaveDoPar(b.cargo, b.cidade_slug);
    const atual = demanda.get(chave);
    if (!atual) demanda.set(chave, { busca: b, pessoas: new Set([b.user_id]) });
    else {
      atual.pessoas.add(b.user_id);
      if (Date.parse(b.criado_em) > Date.parse(atual.busca.criado_em)) atual.busca = b;
    }
  }

  const porPessoas = [...demanda.entries()].sort((a, b) => b[1].pessoas.size - a[1].pessoas.size);
  let incluidos = 0;
  for (const [chave, { busca, pessoas }] of porPessoas) {
    const existente = pares.get(chave);
    if (existente) {
      existente.pessoas = pessoas.size; // já está na pré-carga: só anota a demanda
      continue;
    }
    if (incluidos >= (opts.maxDemanda ?? 30)) continue;
    incluidos++;
    pares.set(chave, {
      cargo: busca.cargo.trim(),
      cidade: busca.cidade.trim(),
      cidadeSlug: busca.cidade_slug,
      uf: ufs.get(busca.cidade_slug) ?? null,
      origem: 'demanda',
      pessoas: pessoas.size,
    });
  }

  // Demanda primeiro: se o tempo da madrugada acabar, o que alguém pediu de
  // fato já foi coletado; o que cai é pré-carga.
  return [...pares.values()].sort((a, b) => b.pessoas - a.pessoas);
}

/** UF mais frequente por cidade, a partir de linhas de `jobs`. */
export function ufMaisFrequente(linhas: Array<{ cidade_slug: string | null; uf: string | null }>): Map<string, string> {
  const contagem = new Map<string, Map<string, number>>();
  for (const l of linhas) {
    if (!l.cidade_slug || !l.uf) continue;
    const m = contagem.get(l.cidade_slug) ?? new Map<string, number>();
    m.set(l.uf, (m.get(l.uf) ?? 0) + 1);
    contagem.set(l.cidade_slug, m);
  }
  const saida = new Map<string, string>();
  for (const [slug, m] of contagem) saida.set(slug, [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  return saida;
}
