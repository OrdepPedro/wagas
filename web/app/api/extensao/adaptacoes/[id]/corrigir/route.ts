import { problemaNoPedido } from '../../../../../../../src/curriculo/corrigir.ts';
import {
  corrigir,
  correcoesHoje,
  lerAdaptacaoColada,
  lerCurriculo,
  LIMITE_CORRECOES,
  MENSAGEM_DA_FALHA,
} from '../../../../../../lib/adaptacao.ts';
import { conferirOrigem, corpoDaAdaptacao, json, preflight, recusada } from '../../../../../../lib/extensao.ts';
import { usuarioAtual } from '../../../../../../lib/supabase.ts';

/**
 * Um pedido no chat de revisão da extensão. Mesmo caminho do site
 * (`corrigir` em lib/adaptacao.ts), mesmo teto diário de ajustes.
 * Devolve a adaptação inteira de novo, já com a versão nova e a conversa.
 */
export async function POST(requisicao: Request, contexto: { params: Promise<{ id: string }> }) {
  const h = conferirOrigem(requisicao);
  if (!h) return recusada();

  const id = Number((await contexto.params).id);
  if (!Number.isInteger(id) || id < 1) return json({ erro: 'Adaptação inválida.' }, h, 400);

  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return json({ erro: 'Entre no wagas.' }, h, 401);

  let entrada: unknown;
  try {
    entrada = await requisicao.json();
  } catch {
    return json({ erro: 'Pedido inválido.' }, h, 400);
  }
  const bruto = (entrada as { pedido?: unknown } | null)?.pedido;
  const pedido = typeof bruto === 'string' ? bruto : '';
  const problema = problemaNoPedido(pedido);
  if (problema) return json({ erro: problema }, h, 400);

  const curriculo = await lerCurriculo(usuario.id);
  const adaptacao = curriculo ? await lerAdaptacaoColada(usuario.id, curriculo, { id }) : null;
  if (!curriculo || !adaptacao) return json({ erro: 'Adaptação não encontrada para o currículo salvo.' }, h, 404);

  if ((await correcoesHoje(usuario.id)) >= LIMITE_CORRECOES) {
    return json({ erro: `Você já fez ${LIMITE_CORRECOES} ajustes hoje. O contador zera à meia-noite.` }, h, 429);
  }

  const r = await corrigir(usuario.id, adaptacao, curriculo, { cargo: adaptacao.cargo, empresa: adaptacao.empresa }, pedido);
  if (!r.ok) return json({ erro: MENSAGEM_DA_FALHA[r.falha] }, h, r.falha === 'cota' ? 503 : 502);

  const nova = await lerAdaptacaoColada(usuario.id, curriculo, { id });
  if (!nova) return json({ erro: 'Ajustei, mas não consegui ler o resultado. Tente de novo.' }, h, 500);
  return json(await corpoDaAdaptacao(usuario.id, nova), h);
}

export const OPTIONS = preflight;
