/**
 * Trava 5: a mesma vaga nunca aparece duas vezes no mesmo feed.
 *
 * A garantia é de EXIBIÇÃO, como a trava decidiu: o banco guarda tudo, e o
 * feed esconde a repetição. Colapsar na gravação era destrutivo e errava para
 * o lado caro — a chave empresa + cargo descartou 65% das vagas aprovadas em
 * 23/10, inclusive a mesma rede com vagas em cidades diferentes.
 *
 * Duas regras, nesta ordem:
 *
 *  1. **Anúncio repetido na mesma fonte:** mesmo título EXATO, mesma
 *     descrição, mesmo lugar. Medido em 23/10: o McDonald's publicou 29 vezes
 *     "Atendente de Restaurante (Tijuca - Rio de Janeiro/RJ)", cada uma com um
 *     id, texto idêntico — 138 de 140 grupos repetidos eram assim. Vira um
 *     cartão com `repeticoes`. Lojas diferentes NÃO caem aqui: a rede põe o
 *     bairro no título ("Tijuca", "Barra da Tijuca"), e título diferente fica.
 *  2. **A mesma vaga em fontes diferentes:** mesma empresa, mesmo cargo
 *     normalizado, mesmo lugar (cidade, ou remoto). Fica a melhor versão.
 *
 * Empresa desconhecida nunca colapsa: "não identificada" com "não identificada"
 * não é evidência de nada.
 */
import { normalizarCargo } from '../dedupe.ts';

export interface VagaColapsavel {
  empresa: string;
  cargo: string;
  fonte: string;
  cidade_slug: string | null;
  modelo: string | null;
  data_publicacao: string | null;
  descricao: string | null;
}

function normalizarEmpresa(e: string): string {
  return e
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|s\.?a|eireli|me|grupo|cia)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SEM_EMPRESA = /^(nao identificada|empresa confidencial|confidencial)?$/;

export function chaveDeExibicao(v: VagaColapsavel): string | null {
  const empresa = normalizarEmpresa(v.empresa ?? '');
  if (SEM_EMPRESA.test(empresa)) return null;
  const lugar = v.modelo === 'remoto' ? 'remoto' : v.cidade_slug ?? '?';
  return `${empresa}|${normalizarCargo(v.cargo)}|${lugar}`;
}

/** A que fica: a que tem data real, depois a de descrição mais completa. */
function melhor<T extends VagaColapsavel>(a: T, b: T): T {
  if (Boolean(a.data_publicacao) !== Boolean(b.data_publicacao)) return a.data_publicacao ? a : b;
  return (b.descricao?.length ?? 0) > (a.descricao?.length ?? 0) ? b : a;
}

/** Regra 1: o mesmo anúncio publicado várias vezes na mesma fonte. */
function chaveDeAnuncio(v: VagaColapsavel): string {
  const lugar = v.modelo === 'remoto' ? 'remoto' : v.cidade_slug ?? '?';
  const texto = (v.descricao ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return `${v.fonte}|${v.cargo.replace(/\s+/g, ' ').trim().toLowerCase()}|${lugar}|${texto}`;
}

/**
 * Colapsa mantendo a ordem do feed: cada grupo ocupa a posição da sua
 * primeira aparição, com a melhor versão da vaga. `repeticoes` diz quantos
 * anúncios iguais o cartão representa (1 = só ele).
 */
export function colapsarRepetidas<T extends VagaColapsavel>(
  entrada: T[],
): { vagas: Array<T & { repeticoes: number }>; colapsadas: number } {
  // Regra 1 primeiro: anúncios idênticos da mesma fonte viram um.
  const porAnuncio = new Map<string, T & { repeticoes: number }>();
  const vagas: Array<T & { repeticoes: number }> = [];
  let colapsadas = 0;
  for (const v of entrada) {
    const chave = chaveDeAnuncio(v);
    const primeiro = porAnuncio.get(chave);
    if (primeiro) { primeiro.repeticoes++; colapsadas++; continue; }
    const comContagem = { ...v, repeticoes: 1 };
    porAnuncio.set(chave, comContagem);
    vagas.push(comContagem);
  }

  // Regra 2: a mesma vaga em fontes diferentes.
  const grupos = new Map<string, { posicao: number; porFonte: Map<string, Array<T & { repeticoes: number }>> }>();
  const ordem: Array<{ chave: string } | { vaga: T & { repeticoes: number } }> = [];

  for (const v of vagas) {
    const chave = chaveDeExibicao(v);
    if (!chave) { ordem.push({ vaga: v }); continue; }
    let g = grupos.get(chave);
    if (!g) {
      g = { posicao: ordem.length, porFonte: new Map() };
      grupos.set(chave, g);
      ordem.push({ chave });
    }
    g.porFonte.set(v.fonte, [...(g.porFonte.get(v.fonte) ?? []), v]);
  }

  const saida: Array<T & { repeticoes: number }> = [];
  for (const item of ordem) {
    if ('vaga' in item) { saida.push(item.vaga); continue; }
    const porFonte = grupos.get(item.chave)!.porFonte;
    if (porFonte.size === 1) {
      saida.push(...[...porFonte.values()][0]!); // mesma fonte: anúncios diferentes, ficam todos
      continue;
    }
    // Fontes diferentes: a mesma vaga anunciada em mais de um lugar. Fica uma
    // por grupo — e, se uma fonte trouxe várias, as outras dela também ficam,
    // porque entre si elas são anúncios distintos.
    const todas = [...porFonte.values()].flat();
    const vencedora = todas.reduce(melhor);
    const fonteVencedora = vencedora.fonte;
    const daMesmaFonte = porFonte.get(fonteVencedora)!;
    saida.push(...daMesmaFonte);
    colapsadas += todas.length - daMesmaFonte.length;
  }
  return { vagas: saida, colapsadas };
}
