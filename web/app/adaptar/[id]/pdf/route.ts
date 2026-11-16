import { NextResponse } from 'next/server';
import { lerAdaptacao, lerCurriculo } from '../../../../lib/adaptacao.ts';
import { gerarPdf, nomeDoArquivo } from '../../../../lib/pdf-curriculo.ts';
import { clienteDoServidor, usuarioAtual } from '../../../../lib/supabase.ts';

/**
 * O PDF é gerado a cada download, a partir da adaptação guardada — não é
 * guardado como arquivo. Um PDF guardado seria uma segunda cópia do CV para
 * apagar quando a pessoa pedir.
 */
export async function GET(_requisicao: Request, contexto: { params: Promise<{ id: string }> }) {
  const { id } = await contexto.params;
  const jobId = Number(id);
  const base = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000';
  if (!Number.isInteger(jobId) || jobId < 1) return NextResponse.redirect(new URL('/vagas', base));

  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) return NextResponse.redirect(new URL('/', base));

  const curriculo = await lerCurriculo(usuario.id);
  const adaptacao = curriculo ? await lerAdaptacao(usuario.id, jobId, curriculo) : null;
  // Sem confirmar a versão atual, volta para a revisão: o PDF só sai depois de lido.
  if (!adaptacao || !adaptacao.confirmada) return NextResponse.redirect(new URL(`/adaptar/${jobId}#baixar`, base));

  const supabase = await clienteDoServidor();
  const { data: vaga } = await supabase.from('jobs').select('cargo').eq('id', jobId).maybeSingle();

  const pdf = await gerarPdf(adaptacao.resultado);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${nomeDoArquivo(adaptacao.resultado.nome, vaga?.cargo ?? '')}"`,
      // CV é dado pessoal: nada de cache compartilhado no caminho.
      'cache-control': 'private, no-store',
    },
  });
}
