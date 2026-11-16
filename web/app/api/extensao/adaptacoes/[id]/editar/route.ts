import { lerAdaptacaoColada, lerCurriculo, salvarEdicao } from '../../../../../../lib/adaptacao.ts';
import { conferirOrigem, corpoDaAdaptacao, json, preflight, recusada } from '../../../../../../lib/extensao.ts';
import { usuarioAtual } from '../../../../../../lib/supabase.ts';

/**
 * Edição manual do currículo no painel da extensão: o que a pessoa digitou vira
 * a versão nova (sem IA, sem teto). Mesmo caminho do site (`salvarEdicao`).
 */
export async function POST(requisicao: Request, contexto: { params: Promise<{ id: string }> }) {
  const h = conferirOrigem(requisicao);
  if (!h) return recusada();

  const id = Number((await contexto.params).id);
  if (!Number.isInteger(id) || id < 1) return json({ erro: 'Adaptação inválida.' }, h, 400);

  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return json({ erro: 'Entre no wagas.' }, h, 401);

  let editado: unknown;
  try {
    editado = ((await requisicao.json()) as { curriculo?: unknown } | null)?.curriculo;
  } catch {
    return json({ erro: 'Pedido inválido.' }, h, 400);
  }

  const curriculo = await lerCurriculo(usuario.id);
  const adaptacao = curriculo ? await lerAdaptacaoColada(usuario.id, curriculo, { id }) : null;
  if (!curriculo || !adaptacao) return json({ erro: 'Adaptação não encontrada para o currículo salvo.' }, h, 404);

  const r = await salvarEdicao(usuario.id, adaptacao, editado);
  if ('erro' in r) return json({ erro: r.erro }, h, 400);

  const nova = await lerAdaptacaoColada(usuario.id, curriculo, { id });
  if (!nova) return json({ erro: 'Salvei, mas não consegui ler o resultado. Tente de novo.' }, h, 500);
  return json(await corpoDaAdaptacao(usuario.id, nova), h);
}

export const OPTIONS = preflight;
