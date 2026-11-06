import { adaptacaoDisponivel, adaptacoesHoje, lerCurriculo, LIMITE_ADAPTACOES } from '../../../../lib/adaptacao.ts';
import { conferirOrigem, json, preflight, recusada, URL_DO_SITE } from '../../../../lib/extensao.ts';
import { usuarioAtual } from '../../../../lib/supabase.ts';

/**
 * O que a extensão precisa saber para escolher a tela: logado? com e-mail?
 * tem CV salvo? quantas adaptações restam hoje? Só lê.
 */
export async function GET(requisicao: Request) {
  const h = conferirOrigem(requisicao);
  if (!h) return recusada();

  const site = URL_DO_SITE();
  const usuario = await usuarioAtual();
  if (!usuario) return json({ estado: 'sem_sessao', site }, h);
  if (usuario.visitante) return json({ estado: 'visitante', site }, h);

  const curriculo = await lerCurriculo(usuario.id);
  if (!curriculo) return json({ estado: 'sem_curriculo', site, email: usuario.email }, h);

  const usadas = await adaptacoesHoje(usuario.id);
  return json(
    {
      estado: adaptacaoDisponivel() ? 'pronto' : 'indisponivel',
      site,
      email: usuario.email,
      curriculoAtualizadoEm: curriculo.atualizadoEm,
      restantes: Math.max(LIMITE_ADAPTACOES - usadas, 0),
      limite: LIMITE_ADAPTACOES,
    },
    h,
  );
}

export const OPTIONS = preflight;
