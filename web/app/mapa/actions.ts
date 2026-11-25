'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { acessoAtivo, ehAba, ehStatus, perfilDoFormulario, validarManual } from '../../../src/mapa/regras.ts';
import { lerCurriculo } from '../../lib/adaptacao.ts';
import { adicionarBusca, desligarAlertas, ligarAlertas, removerBusca } from '../../lib/alertas.ts';
import {
  apagarCandidatura,
  comparacoesHoje,
  comparar,
  iniciarTeste,
  lerComparacao,
  limiteDeComparacoes,
  vagaParaComparar,
  inserirManual,
  lerAcesso,
  mudarStatus,
  registrarCandidatura,
  salvarPerfilDoMapa,
} from '../../lib/mapa.ts';
import { usuarioAtual } from '../../lib/supabase.ts';

/**
 * Os avisos viajam como CÓDIGO na URL (`/mapa?aviso=...`) e a página traduz.
 * Texto livre na query string viraria mensagem falsa com o domínio do wagas.
 */
export type Aviso =
  | 'salvo'
  | 'candidatura'
  | 'falha'
  | 'manual_invalida'
  | 'travado'
  | 'alerta_invalido'
  | 'alerta_repetido'
  | 'alerta_limite';

/**
 * Volta para a seção do painel de onde o formulário saiu (campo oculto `aba`),
 * com o aviso. Sem aba conhecida, volta à visão geral.
 */
function voltar(form: FormData | null, aviso?: Aviso): never {
  revalidatePath('/mapa');
  const params = new URLSearchParams();
  const aba = form?.get('aba');
  if (ehAba(aba) && aba !== 'geral') params.set('aba', aba);
  if (aviso) params.set('aviso', aviso);
  const query = params.toString();
  redirect((query ? `/mapa?${query}` : '/mapa') as Route);
}

/** Conta com e-mail e acesso em dia. Toda ação que grava passa por aqui. */
async function usuarioComAcesso(form: FormData): Promise<string> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) redirect('/entrar' as Route);
  const acesso = await lerAcesso(usuario.id);
  if (!acessoAtivo(acesso)) voltar(form, 'travado');
  return usuario.id;
}

export async function comecarTeste(): Promise<void> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) redirect('/entrar' as Route);
  voltar(null, (await iniciarTeste(usuario.id)) ? undefined : 'falha');
}

export async function salvarFiltros(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const perfil = perfilDoFormulario({
    nivel: String(form.get('nivel') ?? ''),
    modelos: form.getAll('modelos').map(String),
    contrato: String(form.get('contrato') ?? ''),
    pretensao: String(form.get('pretensao') ?? ''),
  });
  voltar(form, (await salvarPerfilDoMapa(userId, perfil)) ? 'salvo' : 'falha');
}

const idDoFormulario = (form: FormData, campo: string): number | null => {
  const id = Number(form.get(campo));
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** "Já me candidatei", no cartão da vaga. */
export async function marcarCandidatura(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const jobId = idDoFormulario(form, 'job_id');
  if (!jobId) voltar(form, 'falha');
  voltar(form, (await registrarCandidatura(userId, jobId, 'enviada', 'feed')) ? 'candidatura' : 'falha');
}

/** Resposta ao "você se candidatou?". */
export async function responderPergunta(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const jobId = idDoFormulario(form, 'job_id');
  if (!jobId) voltar(form, 'falha');
  const sim = form.get('resposta') === 'sim';
  const ok = await registrarCandidatura(userId, jobId, sim ? 'enviada' : 'nao_enviada', 'pergunta');
  voltar(form, ok ? (sim ? 'candidatura' : undefined) : 'falha');
}

export async function mudarStatusAcao(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const id = idDoFormulario(form, 'id');
  const status = String(form.get('status') ?? '');
  if (!id || !ehStatus(status) || status === 'nao_enviada') voltar(form, 'falha');
  voltar(form, (await mudarStatus(userId, id, status)) ? 'salvo' : 'falha');
}

export async function apagarCandidaturaAcao(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const id = idDoFormulario(form, 'id');
  if (!id) voltar(form, 'falha');
  voltar(form, (await apagarCandidatura(userId, id)) ? undefined : 'falha');
}

export async function inserirManualAcao(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const linha = validarManual({
    cargo: String(form.get('cargo') ?? ''),
    empresa: String(form.get('empresa') ?? ''),
    url: String(form.get('url') ?? ''),
    enviada_em: String(form.get('enviada_em') ?? ''),
    status: String(form.get('status') ?? ''),
  });
  if ('erro' in linha) voltar(form, 'manual_invalida');
  voltar(form, (await inserirManual(userId, linha)) ? 'candidatura' : 'falha');
}

// ---------------------------------------------------------------------------
// Alertas por e-mail (aba "Alertas", migrations 0025 e 0026).
// ---------------------------------------------------------------------------

export async function ligarAlertasAcao(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  voltar(form, (await ligarAlertas(userId)) ? 'salvo' : 'falha');
}

export async function desligarAlertasAcao(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  voltar(form, (await desligarAlertas(userId)) ? 'salvo' : 'falha');
}

export async function adicionarBuscaAcao(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const r = await adicionarBusca(
    userId,
    String(form.get('cargo') ?? ''),
    String(form.get('cidade') ?? ''),
    form.get('so_remoto') === 'on',
  );
  const aviso: Record<typeof r, Aviso> = {
    ok: 'salvo',
    invalida: 'alerta_invalido',
    repetida: 'alerta_repetido',
    limite: 'alerta_limite',
    falha: 'falha',
  };
  voltar(form, aviso[r]);
}

export async function removerBuscaAcao(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const id = idDoFormulario(form, 'id');
  if (!id) voltar(form, 'falha');
  voltar(form, (await removerBusca(userId, id)) ? undefined : 'falha');
}

/** Códigos de aviso da página de comparação (`/mapa/comparar/[id]?aviso=`). */
export type AvisoDaComparacao = 'limite' | 'cota' | 'falha' | 'indisponivel' | 'sem_descricao';

/**
 * "Comparar com meu currículo". Usa o CV salvo em /curriculo; sem ele, manda
 * para lá e volta para cá depois de salvar. Comparação já feita com este CV
 * não é refeita nem conta no teto.
 */
export async function compararAcao(form: FormData): Promise<void> {
  const userId = await usuarioComAcesso(form);
  const jobId = idDoFormulario(form, 'job_id');
  if (!jobId) voltar(form, 'falha');
  const pagina = `/mapa/comparar/${jobId}`;
  const ir = (aviso?: AvisoDaComparacao): never =>
    redirect((aviso ? `${pagina}?aviso=${aviso}` : pagina) as Route);

  const curriculo = await lerCurriculo(userId);
  if (!curriculo) redirect(`/curriculo?comparar=${jobId}` as Route);

  const alvo = await vagaParaComparar(jobId);
  if (!alvo) voltar(form, 'falha');
  if (!alvo.comparavel) ir('sem_descricao');
  if (await lerComparacao(userId, jobId, curriculo.hash)) ir();

  const acesso = await lerAcesso(userId);
  if (!acessoAtivo(acesso)) voltar(form, 'travado');
  if ((await comparacoesHoje(userId)) >= limiteDeComparacoes(acesso)) ir('limite');

  const resultado = await comparar(userId, curriculo, alvo.vaga);
  revalidatePath('/mapa');
  ir(resultado.ok ? undefined : resultado.falha === 'resposta' ? 'falha' : resultado.falha);
}
