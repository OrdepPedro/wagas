/**
 * Leitura do feed, e o registro do que foi pedido.
 *
 * A regra crítica do CLAUDE.md aparece inteira aqui: **busca nunca é disparada
 * por request de usuário**. Este arquivo lê `jobs` e escreve `buscas`; não
 * existe caminho daqui para a Serper, e `consultaDeFeed` — que é quem monta o
 * `WHERE` — também não conhece nenhuma fonte externa (há teste para isso).
 *
 * A consulta vem de `../../src/feed/consulta.ts`, o mesmo módulo que os scripts
 * de linha de comando usam. Reescrevê-la em cima do query builder do SDK
 * criaria uma segunda tradução da regra de família, e duas traduções que
 * divergem produzem feed vazio sem causa aparente.
 */
import { consultaDeFeed, JANELA_DIAS } from '../../src/feed/consulta.ts';
import { clienteDoServidor, SUPABASE_ANON, SUPABASE_URL } from './supabase.ts';

export { JANELA_DIAS };

export interface Vaga {
  id: number;
  empresa: string;
  cargo: string;
  senioridade: string | null;
  modelo: 'remoto' | 'hibrido' | 'presencial' | null;
  localizacao: string | null;
  cidade_slug: string | null;
  uf: string | null;
  pais_br: boolean | null;
  url: string;
  fonte: 'linkedin_job' | 'linkedin_post' | 'ats_gupy';
  descricao: string | null;
  data_publicacao: string | null;
  data_publicacao_origem: string;
  data_referencia: string;
  local_avaliado: boolean;
  confianca: number | null;
}

export interface ResultadoDoFeed {
  vagas: Vaga[];
  cidadeSlug: string;
  /** Quantas vieram porque a cidade bate, e quantas por serem remotas no Brasil. */
  naCidade: number;
  remotas: number;
}

/**
 * O PostgREST é chamado por URL crua porque `consultaDeFeed` devolve uma query
 * string pronta, e o query builder do SDK não a aceita. O token da sessão vai
 * no `authorization`, então a RLS continua valendo: o usuário lê o que a policy
 * `jobs_leitura_autenticada` permite, nada além.
 */
export async function carregarFeed(cargo: string, cidade: string): Promise<ResultadoDoFeed> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('feed pedido sem sessão');

  const consulta = consultaDeFeed({ cargo, cidade });

  const resposta = await fetch(`${SUPABASE_URL()}/rest/v1/jobs?${consulta.query}`, {
    headers: {
      apikey: SUPABASE_ANON(),
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!resposta.ok) {
    throw new Error(`feed ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
  }

  const vagas = (await resposta.json()) as Vaga[];
  const naCidade = vagas.filter((v) => v.cidade_slug === consulta.cidadeSlug).length;

  return {
    vagas,
    cidadeSlug: consulta.cidadeSlug,
    naCidade,
    remotas: vagas.length - naCidade,
  };
}

/**
 * Registra a carga do feed, com a contagem de resultados.
 *
 * A contagem é o campo que faz a tabela valer: demanda descoberta é
 * `resultados = 0`, e ela sai da mesma linha que mede quanto o feed entregou.
 * Uma tabela só para o vazio discordaria desta na primeira semana.
 *
 * Falha aqui não derruba o feed. Perder uma linha de telemetria é barato;
 * mostrar erro para quem só queria ver vaga, não.
 */
export async function registrarBusca(
  userId: string,
  cargo: string,
  cidade: string,
  cidadeSlug: string,
  resultados: number,
): Promise<void> {
  try {
    const supabase = await clienteDoServidor();
    await supabase.from('buscas').insert({
      user_id: userId,
      cargo,
      cidade,
      cidade_slug: cidadeSlug,
      resultados,
    });
  } catch {
    // telemetria não pode quebrar produto
  }
}
