/**
 * Leitura do acervo SEM sessão, para as páginas que o Google indexa.
 *
 * Usa a chave pública como token: o PostgREST trata a requisição como `anon`,
 * e a policy `jobs_leitura_publica` (migration 0021) entrega só vaga ativa.
 * Nunca a chave secreta — o CLAUDE.md é explícito que a leitura passa pela RLS,
 * para vaga desativada não vazar por descuido de consulta.
 *
 * Duas diferenças deliberadas em relação a `carregarFeed`:
 *   - não dispara coleta, nunca. É o robô que abre estas páginas, e a regra
 *     crítica proíbe request → fonte externa; aqui nem há usuário;
 *   - a resposta fica em cache por uma hora. O robô pode abrir 60 páginas em
 *     sequência, e o acervo só muda uma vez por dia (coleta da madrugada).
 *
 * Falha devolve `null`, não lista vazia: a página trata "não deu para ler" e
 * "não há vaga" de jeitos diferentes (achado 24 — fonte caída não é fonte vazia).
 */
import { consultaDeFeed } from '../../src/feed/consulta.ts';
import { colapsarRepetidas } from '../../src/feed/colapsar.ts';
import type { Vaga } from './feed.ts';
import { SUPABASE_ANON, SUPABASE_URL } from './supabase.ts';

export const CACHE_SEGUNDOS = 3600;

export async function lerVagasPublicas(
  cargo: string,
  cidade: string | null,
  limite = 30,
): Promise<{ vagas: Vaga[]; cidadeSlug: string } | null> {
  const soRemoto = cidade === null;
  // Com "só remoto", a cidade é ignorada pela consulta; vai qualquer texto.
  const consulta = consultaDeFeed({ cargo, cidade: cidade ?? 'Brasil', soRemoto, limite: limite * 3 });

  try {
    const chave = SUPABASE_ANON();
    const resposta = await fetch(`${SUPABASE_URL()}/rest/v1/jobs?${consulta.query}`, {
      headers: { apikey: chave, authorization: `Bearer ${chave}` },
      next: { revalidate: CACHE_SEGUNDOS },
    });
    if (!resposta.ok) return null;
    const vagas = colapsarRepetidas((await resposta.json()) as Vaga[]).vagas.slice(0, limite);
    return { vagas, cidadeSlug: consulta.cidadeSlug };
  } catch {
    return null;
  }
}
