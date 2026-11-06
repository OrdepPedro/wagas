import { NextResponse } from 'next/server';
import { lerAdaptacaoColada, lerCurriculo } from '../../../../../../lib/adaptacao.ts';
import { conferirOrigem, json, preflight, recusada } from '../../../../../../lib/extensao.ts';
import { gerarPdf, nomeDoArquivo } from '../../../../../../lib/pdf-curriculo.ts';
import { usuarioAtual } from '../../../../../../lib/supabase.ts';

/** PDF da adaptação de vaga colada. Gerado a cada download, nunca guardado (igual ao do feed). */
export async function GET(requisicao: Request, contexto: { params: Promise<{ id: string }> }) {
  const h = conferirOrigem(requisicao);
  if (!h) return recusada();

  const id = Number((await contexto.params).id);
  if (!Number.isInteger(id) || id < 1) return json({ erro: 'Adaptação inválida.' }, h, 400);

  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return json({ erro: 'Entre no wagas.' }, h, 401);

  const curriculo = await lerCurriculo(usuario.id);
  const adaptacao = curriculo ? await lerAdaptacaoColada(usuario.id, curriculo, { id }) : null;
  if (!adaptacao) return json({ erro: 'Adaptação não encontrada para o currículo salvo.' }, h, 404);

  const pdf = await gerarPdf(adaptacao.resultado);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      ...h,
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${nomeDoArquivo(adaptacao.resultado.nome, adaptacao.cargo)}"`,
      'access-control-expose-headers': 'content-disposition',
    },
  });
}

export const OPTIONS = preflight;
