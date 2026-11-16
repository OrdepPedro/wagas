import { lerVagaColada } from '../../../../../src/curriculo/vaga-colada.ts';
import {
  adaptacoesHoje,
  adaptar,
  lerAdaptacaoColada,
  lerCurriculo,
  LIMITE_ADAPTACOES,
  MENSAGEM_DA_FALHA,
} from '../../../../lib/adaptacao.ts';
import { conferirOrigem, corpoDaAdaptacao, json, preflight, recusada } from '../../../../lib/extensao.ts';
import { usuarioAtual } from '../../../../lib/supabase.ts';

/**
 * Adapta o CV salvo a uma vaga que a pessoa COLOU na extensão.
 *
 * Mesmo caminho da adaptação do feed (`lib/adaptacao.ts`): só Groq, mesmo teto
 * diário (as duas origens somam), mesma correção de nomes e mesmo alerta de
 * fidelidade. A descrição colada vai ao modelo e não é gravada.
 */
export async function POST(requisicao: Request) {
  const h = conferirOrigem(requisicao);
  if (!h) return recusada();

  const usuario = await usuarioAtual();
  if (!usuario) return json({ erro: 'Entre no wagas para adaptar o currículo.' }, h, 401);
  if (usuario.visitante) return json({ erro: 'Para adaptar o currículo, entre com seu e-mail.' }, h, 401);

  let entrada: unknown;
  try {
    entrada = await requisicao.json();
  } catch {
    return json({ erro: 'Pedido inválido.' }, h, 400);
  }
  const lida = lerVagaColada(entrada);
  if ('erro' in lida) return json({ erro: lida.erro }, h, 400);

  const curriculo = await lerCurriculo(usuario.id);
  if (!curriculo) return json({ erro: 'Guarde seu currículo no wagas antes de adaptar.' }, h, 409);

  // Mesma vaga colada de novo (duplo clique, ou voltou depois): não gasta cota.
  const existente = await lerAdaptacaoColada(usuario.id, curriculo, { vagaHash: lida.hash });
  if (existente) return json(await corpoDaAdaptacao(usuario.id, existente), h);

  if ((await adaptacoesHoje(usuario.id)) >= LIMITE_ADAPTACOES) {
    return json({ erro: `Você já adaptou ${LIMITE_ADAPTACOES} currículos hoje. O contador zera à meia-noite.` }, h, 429);
  }

  const r = await adaptar(
    usuario.id,
    { colada: { cargo: lida.vaga.cargo, empresa: lida.vaga.empresa, hash: lida.hash } },
    curriculo,
    lida.vaga,
  );
  if (!r.ok) return json({ erro: MENSAGEM_DA_FALHA[r.falha] }, h, r.falha === 'cota' ? 503 : 502);

  const feita = await lerAdaptacaoColada(usuario.id, curriculo, r.id ? { id: r.id } : { vagaHash: lida.hash });
  if (!feita) return json({ erro: 'Adaptei, mas não consegui ler o resultado. Tente de novo.' }, h, 500);
  return json(await corpoDaAdaptacao(usuario.id, feita), h);
}

export const OPTIONS = preflight;
