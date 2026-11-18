/**
 * Mapa: gerenciamento de candidaturas (migration 0023).
 *
 * Lê o MESMO feed de `/vagas`, pelo mesmo `carregarFeed`, sempre só do cache:
 * abrir o Mapa não dispara coleta nem gasta busca do teto diário. Por cima do
 * feed entram os filtros da pessoa (`src/mapa/regras.ts`) e as candidaturas.
 *
 * Tudo passa pela chave pública e pela RLS: cada pessoa lê e grava só o que é
 * dela. O início do teste é a exceção de desenho, e mora na policy de insert
 * de `mapa_acessos` (uma vez, com a hora de agora, sem update).
 */
import { LlmIndisponivel, type Provedor } from '../../src/classificar/llm.ts';
import { vagaAdaptavel } from '../../src/curriculo/adaptar.ts';
import { consultaDeFeed, consultaDoLocal } from '../../src/feed/consulta.ts';
import {
  SCHEMA_EXTRACAO,
  interpretarComparacao,
  interpretarExtracao,
  montarPromptDeClassificacao,
  montarPromptDeExtracao,
  placar,
  type Placar,
  type RequisitoComparado,
  type RequisitoDaVaga,
  type VagaParaComparar,
} from '../../src/mapa/comparar.ts';
import {
  COMPARACOES_POR_DIA_NO_TESTE,
  PERFIL_VAZIO,
  estadoDoAcesso,
  separar,
  type Acesso,
  type CandidaturaManual,
  type PerfilDoMapa,
  type Separacao,
  type Status,
} from '../../src/mapa/regras.ts';
import { provedorDoCurriculo, type Curriculo } from './adaptacao.ts';
import { clienteAdministrativo } from './admin.ts';
import { provedorDeCurriculo } from './gemini-curriculo.ts';
import { carregarFeed, type Vaga } from './feed.ts';
import { inicioDoDiaBrasilia } from './limites.ts';
import type { Perfil } from './perfil.ts';
import { clienteDoServidor, SUPABASE_ANON, SUPABASE_URL } from './supabase.ts';

export interface Candidatura {
  id: number;
  job_id: number | null;
  cargo: string;
  empresa: string;
  url: string | null;
  status: Status;
  origem: 'feed' | 'pergunta' | 'manual';
  enviada_em: string;
}

/**
 * `indisponivel` = a migration 0023 não foi aplicada (ou o banco não respondeu).
 * A tela diz isso em vez de oferecer um teste que não conseguiria gravar.
 */
export async function lerAcesso(userId: string): Promise<Acesso | { estado: 'indisponivel' }> {
  const supabase = await clienteDoServidor();
  const { data, error } = await supabase
    .from('mapa_acessos')
    .select('trial_inicio,pago_ate')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { estado: 'indisponivel' };
  return estadoDoAcesso(data);
}

export async function iniciarTeste(userId: string): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error } = await supabase.from('mapa_acessos').insert({ user_id: userId });
  // 23505: já existia. O teste não recomeça, mas não é erro para quem clicou.
  return !error || error.code === '23505';
}

export async function lerPerfilDoMapa(userId: string): Promise<PerfilDoMapa> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase
    .from('mapa_perfis')
    .select('nivel,modelos,contrato,pretensao')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return PERFIL_VAZIO;
  return {
    nivel: data.nivel ?? null,
    modelos: data.modelos ?? [],
    contrato: data.contrato ?? 'tanto_faz',
    pretensao: data.pretensao ?? null,
  };
}

export async function salvarPerfilDoMapa(userId: string, perfil: PerfilDoMapa): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error } = await supabase
    .from('mapa_perfis')
    .upsert({ user_id: userId, ...perfil, atualizado_em: new Date().toISOString() }, { onConflict: 'user_id' });
  return !error;
}

const COLUNAS = 'id,job_id,cargo,empresa,url,status,origem,enviada_em';

/** Todas as linhas, inclusive as respostas "não me candidatei". */
export async function lerCandidaturas(userId: string): Promise<Candidatura[]> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase
    .from('candidaturas')
    .select(COLUNAS)
    .eq('user_id', userId)
    .order('enviada_em', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);
  return (data ?? []) as Candidatura[];
}

/**
 * Registra a candidatura a uma vaga do feed, ou a resposta "não".
 *
 * Cargo, empresa e link são copiados de `jobs` AGORA: a vaga sai da janela em
 * 7 dias, e a candidatura precisa continuar legível depois. O destino do link
 * vem do banco, nunca do formulário.
 *
 * Uma linha por vaga: se já existe, só o status muda. É a regra do produto —
 * a mesma vaga não aparece duas vezes.
 */
export async function registrarCandidatura(
  userId: string,
  jobId: number,
  status: Status,
  origem: 'feed' | 'pergunta',
): Promise<boolean> {
  const supabase = await clienteDoServidor();

  const { data: existente } = await supabase
    .from('candidaturas')
    .select('id')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .maybeSingle();
  if (existente) return mudarStatus(userId, existente.id, status);

  const { data: vaga } = await supabase.from('jobs').select('cargo,empresa,url').eq('id', jobId).maybeSingle();
  if (!vaga) return false;

  const { error } = await supabase.from('candidaturas').insert({
    user_id: userId,
    job_id: jobId,
    cargo: vaga.cargo,
    empresa: vaga.empresa,
    url: vaga.url,
    status,
    origem,
  });
  return !error;
}

export async function inserirManual(userId: string, linha: CandidaturaManual): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error } = await supabase.from('candidaturas').insert({ user_id: userId, origem: 'manual', ...linha });
  return !error;
}

export async function mudarStatus(userId: string, id: number, status: Status): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error } = await supabase
    .from('candidaturas')
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  return !error;
}

export async function apagarCandidatura(userId: string, id: number): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error } = await supabase.from('candidaturas').delete().eq('id', id).eq('user_id', userId);
  return !error;
}

export interface Pergunta {
  jobId: number;
  cargo: string;
  empresa: string;
}

/**
 * "Você se candidatou?" — as vagas que a pessoa abriu por `/ir/[id]` nos
 * últimos 7 dias e sobre as quais ainda não disse nada.
 *
 * O clique não prova candidatura: prova que ela foi até a vaga. Por isso é
 * pergunta e não registro automático. No máximo três por vez, das mais
 * recentes, para a tela não virar interrogatório.
 */
export async function perguntasPendentes(userId: string, respondidas: Set<number>): Promise<Pergunta[]> {
  const supabase = await clienteDoServidor();
  const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: cliques } = await supabase
    .from('cliques')
    .select('job_id')
    .eq('user_id', userId)
    .not('job_id', 'is', null)
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false })
    .limit(50);

  const ids = [...new Set((cliques ?? []).map((c) => c.job_id as number))].filter((id) => !respondidas.has(id)).slice(0, 3);
  if (ids.length === 0) return [];

  const { data: vagas } = await supabase.from('jobs').select('id,cargo,empresa').in('id', ids);
  const porId = new Map((vagas ?? []).map((v) => [v.id as number, v]));
  return ids.flatMap((id) => {
    const v = porId.get(id);
    return v ? [{ jobId: id, cargo: v.cargo as string, empresa: v.empresa as string }] : [];
  });
}

export interface VagasDoMapa extends Separacao<Vaga> {
  cidadeSlug: string;
  /** Vagas tiradas da lista porque a pessoa já registrou candidatura. */
  jaCandidatadas: number;
  /** Vagas de outros cargos no mesmo local e janela. Null = não deu para contar. */
  outraArea: number | null;
}

export async function vagasDoMapa(
  perfil: Perfil,
  filtros: PerfilDoMapa,
  candidaturas: Candidatura[],
): Promise<VagasDoMapa> {
  const pedido = { cargo: perfil.cargo, cidade: perfil.cidade, soRemoto: perfil.soRemoto };
  const feed = await carregarFeed(perfil.cargo, perfil.cidade, { soRemoto: perfil.soRemoto, apenasCache: true });

  // "Não me candidatei" não tira a vaga da lista: a pessoa ainda pode querer.
  const enviadas = new Set(candidaturas.filter((c) => c.status !== 'nao_enviada' && c.job_id).map((c) => c.job_id));
  const abertas = feed.vagas.filter((v) => !enviadas.has(v.id));

  return {
    ...separar(abertas, filtros),
    cidadeSlug: feed.cidadeSlug,
    jaCandidatadas: feed.vagas.length - abertas.length,
    outraArea: await contarOutraArea(pedido),
  };
}

/**
 * Quantas vagas do mesmo local e da mesma janela são de OUTRO cargo.
 *
 * É só contagem: a busca por cargo já as deixa de fora, e listá-las seria
 * mostrar o acervo inteiro da cidade. Duas contagens exatas no PostgREST (HEAD,
 * sem linha), uma menos a outra. Falhou, a tela omite o número.
 */
async function contarOutraArea(pedido: { cargo: string; cidade: string; soRemoto: boolean }): Promise<number | null> {
  try {
    const supabase = await clienteDoServidor();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;

    const contar = async (query: string): Promise<number> => {
      const resposta = await fetch(`${SUPABASE_URL()}/rest/v1/jobs?${query}`, {
        method: 'HEAD',
        headers: { apikey: SUPABASE_ANON(), authorization: `Bearer ${token}`, prefer: 'count=exact' },
        cache: 'no-store',
      });
      // "0-0/1234" ou "*/0"
      const total = Number(resposta.headers.get('content-range')?.split('/')[1]);
      if (!resposta.ok || !Number.isFinite(total)) throw new Error('contagem');
      return total;
    };

    const [noLocal, doCargo] = await Promise.all([
      contar(consultaDoLocal(pedido)),
      contar(consultaDeFeed({ ...pedido, limite: 1 }).query),
    ]);
    return Math.max(0, noLocal - doCargo);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Comparação do currículo com a vaga (migration 0024).
 *
 * Reaproveita o CV salvo em /curriculo e o mesmo provedor da adaptação: o
 * consentimento de lá diz que o CV salvo vai só para o Groq, então a
 * comparação não pode mandá-lo ao Gemini gratuito, cujos termos permitem uso
 * do conteúdo.
 * ------------------------------------------------------------------------- */

/** Pago: ainda não decidido pelo Pedro. Configurável até ser. */
export const LIMITE_COMPARACOES_PAGO = (() => {
  const n = Number(process.env['LIMITE_COMPARACOES_PAGO']?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
})();

export function limiteDeComparacoes(acesso: Acesso): number {
  return acesso.estado === 'pago' ? LIMITE_COMPARACOES_PAGO : COMPARACOES_POR_DIA_NO_TESTE;
}

export interface ComparacaoSalva {
  id: number;
  requisitos: RequisitoComparado[];
  criadoEm: string;
}

/** A comparação mais recente desta vaga com ESTE currículo. Trocou o CV, não vale. */
export async function lerComparacao(userId: string, jobId: number, curriculoHash: string): Promise<ComparacaoSalva | null> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase
    .from('mapa_comparacoes')
    .select('id,resultado,criado_em')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .eq('curriculo_hash', curriculoHash)
    .eq('ok', true)
    .not('resultado', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, requisitos: (data.resultado as { requisitos: RequisitoComparado[] }).requisitos, criadoEm: data.criado_em };
}

/** Placar de cada vaga já comparada com este CV, para a etiqueta na lista. */
export async function placaresDoCurriculo(userId: string, curriculoHash: string): Promise<Map<number, Placar>> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase
    .from('mapa_comparacoes')
    .select('job_id,resultado')
    .eq('user_id', userId)
    .eq('curriculo_hash', curriculoHash)
    .eq('ok', true)
    .not('job_id', 'is', null)
    .not('resultado', 'is', null)
    .order('criado_em', { ascending: true })
    .limit(500);
  const mapa = new Map<number, Placar>();
  for (const linha of data ?? []) {
    const requisitos = (linha.resultado as { requisitos?: RequisitoComparado[] } | null)?.requisitos;
    if (requisitos) mapa.set(linha.job_id as number, placar(requisitos));
  }
  return mapa;
}

/** Comparações bem-sucedidas hoje (Brasília). Erro de leitura não bloqueia ninguém. */
export async function comparacoesHoje(userId: string): Promise<number> {
  try {
    const supabase = await clienteDoServidor();
    const { count, error } = await supabase
      .from('mapa_comparacoes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ok', true)
      .gte('criado_em', inicioDoDiaBrasilia());
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export interface VagaComparavel extends VagaParaComparar {
  id: number;
  url: string;
}

/** A vaga pelo id, pela RLS (só `ativo = true`). Null se não existe ou não tem descrição que dê para comparar. */
export async function vagaParaComparar(jobId: number): Promise<{ vaga: VagaComparavel; comparavel: boolean } | null> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase.from('jobs').select('id,cargo,empresa,descricao,url').eq('id', jobId).maybeSingle();
  if (!data) return null;
  return {
    vaga: { id: data.id, cargo: data.cargo, empresa: data.empresa, descricao: data.descricao ?? '', url: data.url },
    comparavel: vagaAdaptavel(data),
  };
}

export type FalhaDaComparacao = 'indisponivel' | 'cota' | 'resposta';

/**
 * A lista de requisitos da vaga: a guardada, ou extraída agora e guardada.
 *
 * A extração vai ao Gemini, e o Groq só fica de reserva: a vaga é texto
 * público, sem dado pessoal, e cada chamada poupada no Groq é cota que sobra
 * para a classificação e a adaptação, que levam o CV e só podem ir a ele.
 * Grava pela chave de servidor (a tabela é compartilhada; ver 0024). Duas
 * pessoas comparando a mesma vaga ao mesmo tempo: fica a primeira lista.
 */
async function requisitosDaVaga(vaga: VagaComparavel, groq: Provedor): Promise<RequisitoDaVaga[]> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase.from('vaga_requisitos').select('requisitos').eq('job_id', vaga.id).maybeSingle();
  if (data) return data.requisitos as RequisitoDaVaga[];

  const prompt = montarPromptDeExtracao(vaga);
  const gemini = process.env['GEMINI_KEY']?.trim();
  let provedor: Provedor = groq;
  let requisitos: RequisitoDaVaga[];
  try {
    if (!gemini) throw new Error('sem GEMINI_KEY');
    provedor = provedorDeCurriculo(gemini);
    requisitos = interpretarExtracao(await provedor.julgar(prompt, SCHEMA_EXTRACAO));
  } catch {
    provedor = groq;
    requisitos = interpretarExtracao(await groq.julgar(prompt, null));
  }

  await clienteAdministrativo()
    .insert('vaga_requisitos', [{ job_id: vaga.id, requisitos, provedor: provedor.nome }], { ignorarDuplicados: true })
    .catch(() => undefined);
  // Se outra pessoa gravou antes, vale a lista dela: o placar é o mesmo para todos.
  const { data: gravada } = await supabase.from('vaga_requisitos').select('requisitos').eq('job_id', vaga.id).maybeSingle();
  return (gravada?.requisitos as RequisitoDaVaga[] | undefined) ?? requisitos;
}

/**
 * Extrai (se preciso) os requisitos da vaga, classifica o CV contra eles e
 * grava a tentativa, com sucesso ou não. Só em Server Action: grava e gasta
 * cota, e render repete.
 */
export async function comparar(
  userId: string,
  curriculo: Curriculo,
  vaga: VagaComparavel,
): Promise<{ ok: true } | { ok: false; falha: FalhaDaComparacao }> {
  const chave = process.env['GROQ_KEY']?.trim();
  if (!chave) return { ok: false, falha: 'indisponivel' };

  const groq = provedorDoCurriculo(chave);
  const supabase = await clienteDoServidor();
  const inicio = Date.now();
  const base = { user_id: userId, job_id: vaga.id, curriculo_hash: curriculo.hash, provedor: groq.nome };

  try {
    const daVaga = await requisitosDaVaga(vaga, groq);
    const bruto = await groq.julgar(montarPromptDeClassificacao(curriculo.texto, daVaga), null);
    const { requisitos, rebaixados } = interpretarComparacao(bruto, curriculo.texto, daVaga);
    const { error } = await supabase.from('mapa_comparacoes').insert({
      ...base,
      ok: true,
      resultado: { requisitos },
      rebaixados,
      duracao_ms: Date.now() - inicio,
    });
    return error ? { ok: false, falha: 'resposta' } : { ok: true };
  } catch (erro) {
    await supabase.from('mapa_comparacoes').insert({
      ...base,
      ok: false,
      duracao_ms: Date.now() - inicio,
      // A mensagem do provedor, nunca o CV.
      erro: String(erro instanceof Error ? erro.message : erro).slice(0, 300),
    });
    return { ok: false, falha: erro instanceof LlmIndisponivel ? 'cota' : 'resposta' };
  }
}
