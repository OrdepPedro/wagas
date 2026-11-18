'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { problemaNoCurriculo, vagaAdaptavel } from '../../../src/curriculo/adaptar.ts';
import { problemaNoPedido } from '../../../src/curriculo/corrigir.ts';
import {
  adaptacoesHoje,
  adaptar,
  apagarCurriculo,
  confirmar,
  corrigir,
  correcoesHoje,
  lerAdaptacao,
  lerCurriculo,
  LIMITE_ADAPTACOES,
  LIMITE_CORRECOES,
  MENSAGEM_DA_FALHA,
  salvarCurriculo,
  salvarEdicao,
  textoDoArquivo,
} from '../../lib/adaptacao.ts';
import { clienteDoServidor, usuarioAtual } from '../../lib/supabase.ts';

export interface EstadoDoCurriculo {
  erro?: string;
}


/** Para onde voltar depois de salvar. Só caminho interno conhecido — nunca redirecionador aberto. */
function destinoSeguro(bruto: FormDataEntryValue | null): Route {
  const s = String(bruto ?? '');
  return (/^\/(adaptar|mapa\/comparar)\/\d+$/.test(s) ? s : '/curriculo') as Route;
}

export async function salvarCurriculoAcao(
  _anterior: EstadoDoCurriculo,
  form: FormData,
): Promise<EstadoDoCurriculo> {
  const usuario = await usuarioAtual();
  if (!usuario) return { erro: 'Sua sessão expirou. Entre de novo.' };
  if (usuario.visitante) return { erro: 'Para guardar currículo, entre com seu e-mail.' };

  if (form.get('consentimento') !== 'on') {
    return { erro: 'Para guardar o currículo, marque que você concorda com o uso descrito acima.' };
  }

  const arquivo = form.get('pdf');
  let texto = String(form.get('texto') ?? '');
  let origem: 'pdf' | 'texto' = 'texto';

  // Arquivo enviado ganha do texto colado: quem escolheu um arquivo agora quer
  // trocar pelo arquivo. O texto extraído volta para a caixa, para revisar.
  // Tamanho e formato são conferidos pelo leitor do medidor (5 MB, PDF ou DOCX).
  if (arquivo instanceof File && arquivo.size > 0) {
    const lido = await textoDoArquivo(arquivo);
    if ('erro' in lido) return { erro: lido.erro };
    texto = lido.texto;
    origem = 'pdf';
  }

  const problema = problemaNoCurriculo(texto);
  if (problema) return { erro: problema };

  if (!(await salvarCurriculo(usuario.id, texto, origem))) {
    return { erro: 'Não consegui salvar agora. Tente de novo em instantes.' };
  }

  revalidatePath('/curriculo');
  const destino = destinoSeguro(form.get('voltar'));
  // Vindo de PDF, a pessoa vê o texto extraído antes de adaptar qualquer coisa:
  // extração de PDF de duas colunas sai embaralhada, e é ela quem percebe.
  redirect(origem === 'pdf' && destino === '/curriculo' ? ('/curriculo?lido=pdf' as Route) : destino);
}

export async function apagarCurriculoAcao(): Promise<void> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) redirect('/');
  await apagarCurriculo(usuario.id);
  revalidatePath('/curriculo');
  redirect('/curriculo?apagado=1' as Route);
}

export async function adaptarAcao(
  _anterior: EstadoDoCurriculo,
  form: FormData,
): Promise<EstadoDoCurriculo> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return { erro: 'Entre com seu e-mail para adaptar o currículo.' };

  const jobId = Number(form.get('jobId'));
  if (!Number.isInteger(jobId) || jobId < 1) return { erro: 'Vaga inválida.' };

  const curriculo = await lerCurriculo(usuario.id);
  if (!curriculo) redirect(`/curriculo?vaga=${jobId}` as Route);

  // Duplo clique, ou outra aba: já existe para este CV, não gasta cota de novo.
  if (await lerAdaptacao(usuario.id, jobId, curriculo)) redirect(`/adaptar/${jobId}` as Route);

  if ((await adaptacoesHoje(usuario.id)) >= LIMITE_ADAPTACOES) {
    return { erro: `Você já adaptou ${LIMITE_ADAPTACOES} currículos hoje. O contador zera à meia-noite.` };
  }

  const supabase = await clienteDoServidor();
  const { data: vaga } = await supabase
    .from('jobs')
    .select('cargo, empresa, descricao, fonte')
    .eq('id', jobId)
    .maybeSingle();
  if (!vaga || !vagaAdaptavel(vaga)) return { erro: 'Esta vaga não tem descrição suficiente para adaptar.' };

  const resultado = await adaptar(usuario.id, { jobId }, curriculo, vaga);
  if (!resultado.ok) return { erro: MENSAGEM_DA_FALHA[resultado.falha] };

  redirect(`/adaptar/${jobId}` as Route);
}

export interface EstadoDoAjuste {
  erro?: string;
  /** Devolvido no erro para a caixa não perder o que a pessoa escreveu. */
  pedido?: string;
  /** Muda a cada envio que deu certo: a tela usa como `key` para limpar a caixa. */
  enviado?: number;
}

/** Um pedido no chat de revisão da adaptação de uma vaga do feed. */
export async function corrigirAcao(_anterior: EstadoDoAjuste, form: FormData): Promise<EstadoDoAjuste> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return { erro: 'Sua sessão expirou. Entre de novo.' };

  const jobId = Number(form.get('jobId'));
  if (!Number.isInteger(jobId) || jobId < 1) return { erro: 'Vaga inválida.' };
  const pedido = String(form.get('pedido') ?? '');
  const problema = problemaNoPedido(pedido);
  if (problema) return { erro: problema, pedido };

  const curriculo = await lerCurriculo(usuario.id);
  if (!curriculo) redirect(`/curriculo?vaga=${jobId}` as Route);
  const adaptacao = await lerAdaptacao(usuario.id, jobId, curriculo);
  if (!adaptacao) redirect(`/adaptar/${jobId}` as Route);

  if ((await correcoesHoje(usuario.id)) >= LIMITE_CORRECOES) {
    return { erro: `Você já fez ${LIMITE_CORRECOES} ajustes hoje. O contador zera à meia-noite.`, pedido };
  }

  const supabase = await clienteDoServidor();
  const { data: vaga } = await supabase.from('jobs').select('cargo, empresa').eq('id', jobId).maybeSingle();

  const r = await corrigir(usuario.id, adaptacao, curriculo, vaga ?? { cargo: '', empresa: '' }, pedido);
  if (!r.ok) return { erro: MENSAGEM_DA_FALHA[r.falha], pedido };

  revalidatePath(`/adaptar/${jobId}`);
  return { enviado: Date.now() };
}

/** "Revisei": libera o PDF da versão que estava na tela. */
export async function confirmarAcao(form: FormData): Promise<void> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) redirect('/');

  const jobId = Number(form.get('jobId'));
  const versao = Number(form.get('versao'));
  if (!Number.isInteger(jobId) || jobId < 1 || !Number.isInteger(versao) || versao < 0) redirect('/vagas');

  const curriculo = await lerCurriculo(usuario.id);
  const adaptacao = curriculo ? await lerAdaptacao(usuario.id, jobId, curriculo) : null;
  if (adaptacao) await confirmar(usuario.id, adaptacao.id, versao);

  revalidatePath(`/adaptar/${jobId}`);
  redirect(`/adaptar/${jobId}` as Route);
}

export interface EstadoDaEdicao {
  erro?: string;
  /** Muda a cada edição salva: a tela usa para sair do modo de edição. */
  salvo?: number;
}

/** O currículo editado à mão vira a versão nova da adaptação (sem IA, sem teto). */
export async function salvarEdicaoAcao(_anterior: EstadoDaEdicao, form: FormData): Promise<EstadoDaEdicao> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return { erro: 'Sua sessão expirou. Entre de novo.' };

  const jobId = Number(form.get('jobId'));
  if (!Number.isInteger(jobId) || jobId < 1) return { erro: 'Vaga inválida.' };
  let editado: unknown;
  try {
    editado = JSON.parse(String(form.get('curriculo') ?? ''));
  } catch {
    return { erro: 'Edição inválida.' };
  }

  const curriculo = await lerCurriculo(usuario.id);
  if (!curriculo) redirect(`/curriculo?vaga=${jobId}` as Route);
  const adaptacao = await lerAdaptacao(usuario.id, jobId, curriculo);
  if (!adaptacao) redirect(`/adaptar/${jobId}` as Route);

  const r = await salvarEdicao(usuario.id, adaptacao, editado);
  if ('erro' in r) return { erro: r.erro };

  revalidatePath(`/adaptar/${jobId}`);
  return { salvo: Date.now() };
}
