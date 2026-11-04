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
import { after } from 'next/server';
import { chaveDeFamilia } from '../../src/classificar/familia.ts';
import {
  avisoDoPedido,
  dispararColeta,
  lerPedido,
  marcarFalha,
  pedirOutraFonte,
  type AvisoDaOutraFonte,
} from '../../src/coleta/outra-fonte.ts';
import { consultaDeFeed, JANELA_DIAS } from '../../src/feed/consulta.ts';
import { colapsarRepetidas } from '../../src/feed/colapsar.ts';
import { preencherSeNecessario, type MotivoDoPreenchimento } from '../../src/fontes/sob-demanda.ts';
import { clienteAdministrativo, coletaSobDemandaDisponivel } from './admin.ts';
import { chaveDaBusca, ehRepeticao, lerBuscaDaSessao } from './sessao.ts';
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
  fonte: 'linkedin_job' | 'linkedin_post' | 'ats_gupy' | 'ats_inhire' | 'portal_infojobs';
  descricao: string | null;
  data_publicacao: string | null;
  data_publicacao_origem: string;
  data_referencia: string;
  local_avaliado: boolean;
  confianca: number | null;
  tipo_contrato: string | null;
  /** Anúncios idênticos que este cartão representa (trava 5). Não vem do banco. */
  repeticoes?: number;
}

/** Teto de cartões no feed. Era o `limit` padrão da consulta. */
const MOSTRAR = 100;

export interface ResultadoDoFeed {
  vagas: Vaga[];
  cidadeSlug: string;
  /** Quantas vieram porque a cidade bate, e quantas por serem remotas no Brasil. */
  naCidade: number;
  remotas: number;
  /** O que a coleta sob demanda fez antes desta leitura. Vai para o log e para o rodapé. */
  coleta: MotivoDoPreenchimento | 'desligada' | 'ja_visto_na_sessao' | 'limite_atingido';
  vagasNovas: number;
  soRemoto: boolean;
  /** Coleta da outra fonte pedida por esta busca (ou por outra pessoa, no mesmo par). */
  outraFonte: AvisoDaOutraFonte | null;
}

/**
 * O PostgREST é chamado por URL crua porque `consultaDeFeed` devolve uma query
 * string pronta, e o query builder do SDK não a aceita. O token da sessão vai
 * no `authorization`, então a RLS continua valendo: o usuário lê o que a policy
 * `jobs_leitura_autenticada` permite, nada além.
 */
export async function carregarFeed(
  cargo: string,
  cidade: string,
  opcoes: { soRemoto?: boolean; apenasCache?: boolean } = {},
): Promise<ResultadoDoFeed> {
  // ORDEM QUE IMPORTA: a fonte externa popula o cache, e só depois o feed lê o
  // cache. O usuário nunca lê o resultado de uma chamada externa direto — se a
  // fonte cair, ele vê o acervo que já existe em vez de um erro. É a regra
  // "coleta popula, usuário lê" preservada, com um gatilho novo.
  const soRemoto = Boolean(opcoes.soRemoto);
  let coleta: ResultadoDoFeed['coleta'] = 'desligada';
  let vagasNovas = 0;

  // Camada rasa: a sessão já pediu exatamente esta busca antes. Ela só permite
  // PULAR trabalho, nunca autoriza nada — quem garante é `coletas_sob_demanda`,
  // no banco, que vale para todos os usuários e todos os dispositivos. Quem
  // ESCREVE a sessão é a ação de buscar; aqui só se lê, porque Server Component
  // não pode gravar cookie.
  const chave = chaveDaBusca(cargo, cidade, soRemoto);
  const jaVista = ehRepeticao(await lerBuscaDaSessao(), chave);

  // Teto diário estourado: o feed ainda mostra o acervo, mas não dispara
  // trabalho novo. É a diferença entre limitar e punir.
  if (opcoes.apenasCache) {
    coleta = 'limite_atingido';
  } else if (jaVista) {
    coleta = 'ja_visto_na_sessao';
  } else if (coletaSobDemandaDisponivel()) {
    const preenchimento = await preencherSeNecessario(clienteAdministrativo(), {
      cargo,
      cidade: soRemoto ? null : cidade,
      ...(soRemoto ? { soRemoto: true } : {}),
    });
    coleta = preenchimento.motivo;
    vagasNovas = preenchimento.vagasGravadas;
  }

  const outraFonte = soRemoto
    ? null
    : await acompanharOutraFonte(cargo, cidade, coleta === 'limite_atingido' || coleta === 'ja_visto_na_sessao');

  const supabase = await clienteDoServidor();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('feed pedido sem sessão');

  // Pede três vezes o que mostra: o colapso da trava 5 pode tirar muito. Em
  // Atendente/Rio, 150 linhas viraram 42 cartões (108 anúncios repetidos do
  // McDonald's) — com folga pequena, o feed encolhia com vaga sobrando no banco.
  const consulta = consultaDeFeed({ cargo, cidade, soRemoto, limite: MOSTRAR * 3 });

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

  // Trava 5: a mesma vaga, vinda de fontes diferentes, aparece uma vez só.
  const vagas = colapsarRepetidas((await resposta.json()) as Vaga[]).vagas.slice(0, MOSTRAR);
  const naCidade = vagas.filter((v) => v.cidade_slug === consulta.cidadeSlug).length;

  return {
    vagas,
    cidadeSlug: consulta.cidadeSlug,
    naCidade,
    remotas: vagas.length - naCidade,
    coleta,
    vagasNovas,
    soRemoto,
    outraFonte,
  };
}

/**
 * Pede a coleta do par na outra fonte (InfoJobs) e diz o que a tela mostra.
 *
 * Só PEDE: grava em `pedidos_outra_fonte` e dispara o workflow depois da
 * resposta (`after`), para a busca não esperar a API do GitHub. Quem abre o
 * InfoJobs é o Actions. Repetição na sessão e teto estourado só leem o estado.
 *
 * Qualquer falha some em silêncio: sem a migration 0017 ou sem o token, o feed
 * funciona como antes.
 */
async function acompanharOutraFonte(
  cargo: string,
  cidade: string,
  soLer: boolean,
): Promise<AvisoDaOutraFonte | null> {
  const token = process.env['GITHUB_DISPATCH_TOKEN']?.trim();
  if (!token || !coletaSobDemandaDisponivel()) return null;

  try {
    const db = clienteAdministrativo();
    const agora = new Date();
    if (soLer) return avisoDoPedido(await lerPedido(db, cargo, cidade), agora);

    const { pedido, novo } = await pedirOutraFonte(db, { cargo, cidade }, agora);
    if (novo && pedido) {
      const repo = process.env['GITHUB_REPO']?.trim() || 'OrdepPedro/wagas';
      after(async () => {
        if (!(await dispararColeta({ token, repo }))) await marcarFalha(db, pedido, 'disparo do workflow falhou');
      });
    }
    return avisoDoPedido(pedido, agora);
  } catch {
    return null;
  }
}

/**
 * Janela em que uma busca repetida é considerada a MESMA busca.
 *
 * Existe por um defeito medido, não por preferência: `registrarBusca` roda
 * durante a renderização de um Server Component, e render pode repetir —
 * documento mais payload de RSC, prefetch do Next, re-render em
 * desenvolvimento. Sem esta janela, cada carga de feed gravava DUAS linhas, e
 * toda métrica de busca saía inflada em 2x, inclusive a contagem de pedidos da
 * `demanda_descoberta`, que é a fila de priorização da coleta.
 *
 * Um minuto também é a leitura honesta do comportamento: quem recarrega a
 * página em menos de um minuto não fez uma busca nova.
 */
const JANELA_DE_REPETICAO_MS = 60_000;

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

    const desde = new Date(Date.now() - JANELA_DE_REPETICAO_MS).toISOString();
    const { data: recente } = await supabase
      .from('buscas')
      .select('id')
      .eq('user_id', userId)
      .eq('cidade_slug', cidadeSlug)
      .eq('cargo', cargo)
      .gte('criado_em', desde)
      .limit(1);

    if (recente && recente.length > 0) return;

    await supabase.from('buscas').insert({
      user_id: userId,
      cargo,
      cidade,
      cidade_slug: cidadeSlug,
      // Chave de família calculada em TS, com as mesmas funções que decidem se
      // um cargo bate com uma vaga. É o que faz "Enfermeira" e "Enfermeiro"
      // virarem UM pedido na fila de coleta em vez de dois sinais fracos.
      cargo_familia: chaveDeFamilia(cargo),
      resultados,
    });
  } catch {
    // telemetria não pode quebrar produto
  }
}
