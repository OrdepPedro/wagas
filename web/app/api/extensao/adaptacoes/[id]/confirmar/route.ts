import { confirmar, lerAdaptacaoColada, lerCurriculo } from '../../../../../../lib/adaptacao.ts';
import { conferirOrigem, corpoDaAdaptacao, json, preflight, recusada } from '../../../../../../lib/extensao.ts';
import { usuarioAtual } from '../../../../../../lib/supabase.ts';

/**
 * "Revisei": confirma a versão que o painel estava mostrando (`versao`) e
 * libera o PDF dela. Se um ajuste entrou no meio, a confirmação não vale para
 * a versão nova — a resposta volta com `confirmada: false` e o painel pede de novo.
 */
export async function POST(requisicao: Request, contexto: { params: Promise<{ id: string }> }) {
  const h = conferirOrigem(requisicao);
  if (!h) return recusada();

  const id = Number((await contexto.params).id);
  if (!Number.isInteger(id) || id < 1) return json({ erro: 'Adaptação inválida.' }, h, 400);

  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return json({ erro: 'Entre no wagas.' }, h, 401);

  let versao = NaN;
  try {
    versao = Number(((await requisicao.json()) as { versao?: unknown } | null)?.versao);
  } catch {
    // cai na validação abaixo
  }
  if (!Number.isInteger(versao) || versao < 0) return json({ erro: 'Versão inválida.' }, h, 400);

  const curriculo = await lerCurriculo(usuario.id);
  const adaptacao = curriculo ? await lerAdaptacaoColada(usuario.id, curriculo, { id }) : null;
  if (!curriculo || !adaptacao) return json({ erro: 'Adaptação não encontrada para o currículo salvo.' }, h, 404);

  if (!(await confirmar(usuario.id, id, versao))) {
    return json({ erro: 'Não consegui confirmar agora. Tente de novo.' }, h, 500);
  }
  const confirmada = await lerAdaptacaoColada(usuario.id, curriculo, { id });
  return json(await corpoDaAdaptacao(usuario.id, confirmada ?? adaptacao), h);
}

export const OPTIONS = preflight;
