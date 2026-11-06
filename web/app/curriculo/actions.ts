'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { problemaNoCurriculo, vagaAdaptavel } from '../../../src/curriculo/adaptar.ts';
import {
  adaptacoesHoje,
  adaptar,
  apagarCurriculo,
  lerAdaptacao,
  lerCurriculo,
  LIMITE_ADAPTACOES,
  salvarCurriculo,
  textoDoArquivo,
} from '../../lib/adaptacao.ts';
import { clienteDoServidor, usuarioAtual } from '../../lib/supabase.ts';

export interface EstadoDoCurriculo {
  erro?: string;
}


/** Para onde voltar depois de salvar. Só caminho interno conhecido — nunca redirecionador aberto. */
function destinoSeguro(bruto: FormDataEntryValue | null): Route {
  const s = String(bruto ?? '');
  return (/^\/adaptar\/\d+$/.test(s) ? s : '/curriculo') as Route;
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

const MENSAGEM_DA_FALHA = {
  indisponivel: 'A adaptação está desligada neste ambiente.',
  cota: 'O serviço de IA está no limite agora. Tente de novo em alguns minutos.',
  resposta: 'A IA devolveu uma resposta que não consegui usar. Tente de novo.',
} as const;

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
