/**
 * Dados reais para a landing: quantas vagas estão na janela agora, e alguns
 * cartões de verdade para a janela de navegador do hero.
 *
 * Prova social honesta: no lugar de "120.000 usuários" ou nota de avaliação,
 * que não temos, a contagem viva do acervo. Ela muda todo dia e é verificável.
 *
 * Lê pela RLS (`jobs_leitura_autenticada`), como o feed. Falha devolve vazio:
 * a landing funciona sem os números, só não mostra o selo nem os cartões.
 */
import { JANELA_DIAS } from '../../src/feed/consulta.ts';
import { clienteDoServidor } from './supabase.ts';

export interface CartaoDaVitrine {
  id: number;
  cargo: string;
  empresa: string;
  localizacao: string | null;
  modelo: 'remoto' | 'hibrido' | 'presencial' | null;
  fonte: 'linkedin_job' | 'linkedin_post' | 'ats_gupy' | 'ats_inhire' | 'ats_greenhouse' | 'portal_infojobs';
  data_publicacao: string;
}

export interface Vitrine {
  vagasNaJanela: number | null;
  cartoes: CartaoDaVitrine[];
}

export async function carregarVitrine(): Promise<Vitrine> {
  const desde = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = await clienteDoServidor();
    const [contagem, recentes] = await Promise.all([
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('ativo', true)
        .is('encerrada_em', null)
        .gte('data_referencia', desde),
      // Cartões só com empresa e data de publicação reais: a vitrine mostra o
      // melhor caso do feed, mas um caso que existe.
      supabase
        .from('jobs')
        .select('id, cargo, empresa, localizacao, modelo, fonte, data_publicacao')
        .eq('ativo', true)
        .is('encerrada_em', null)
        .not('data_publicacao', 'is', null)
        .neq('empresa', 'não identificada')
        .gte('data_publicacao', desde)
        .order('data_publicacao', { ascending: false })
        .limit(12),
    ]);

    // Uma de cada fonte primeiro, para a vitrine não parecer de uma fonte só.
    const todas = (recentes.data ?? []) as CartaoDaVitrine[];
    const escolhidas: CartaoDaVitrine[] = [];
    for (const c of todas) {
      if (!escolhidas.some((e) => e.fonte === c.fonte)) escolhidas.push(c);
    }
    for (const c of todas) {
      if (escolhidas.length >= 3) break;
      if (!escolhidas.includes(c)) escolhidas.push(c);
    }

    return { vagasNaJanela: contagem.count ?? null, cartoes: escolhidas.slice(0, 3) };
  } catch {
    return { vagasNaJanela: null, cartoes: [] };
  }
}
