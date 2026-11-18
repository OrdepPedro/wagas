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
import { consultaDeFeed, consultaDoLocal } from '../../src/feed/consulta.ts';
import {
  PERFIL_VAZIO,
  estadoDoAcesso,
  separar,
  type Acesso,
  type CandidaturaManual,
  type PerfilDoMapa,
  type Separacao,
  type Status,
} from '../../src/mapa/regras.ts';
import { carregarFeed, type Vaga } from './feed.ts';
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
