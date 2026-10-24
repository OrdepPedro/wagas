import { NextResponse } from 'next/server';
import { clienteDoServidor, usuarioAtual } from '../../../lib/supabase.ts';

/**
 * Conta o clique e manda o usuário para a vaga.
 *
 * Por que uma rota e não um `onClick`: a métrica que decide o produto é clique
 * em "ver vaga" por usuário por semana (CLAUDE.md). Um contador em JavaScript no
 * cliente perde bloqueador de anúncio, aba aberta no meio do botão e navegação
 * antes do evento subir. Aqui o clique só deixa de ser contado se o servidor
 * não responder — e nesse caso o usuário também não chega na vaga.
 *
 * A URL de destino vem do BANCO, nunca da query string. Aceitar destino por
 * parâmetro transformaria isto num redirecionador aberto, que é como se
 * distribui phishing com o domínio de outra pessoa.
 */
export async function GET(
  _requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
) {
  const { id } = await contexto.params;
  const jobId = Number(id);

  if (!Number.isInteger(jobId) || jobId < 1) {
    return NextResponse.redirect(new URL('/vagas', process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000'));
  }

  const usuario = await usuarioAtual();
  const supabase = await clienteDoServidor();

  // A RLS já limita a leitura a vagas ativas, então uma vaga desativada pelo
  // portão de local não vira redirecionamento nem por link antigo.
  const { data: vaga } = await supabase.from('jobs').select('url').eq('id', jobId).maybeSingle();

  if (!vaga?.url) {
    return NextResponse.redirect(new URL('/vagas', process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000'));
  }

  if (usuario) {
    // Falha de telemetria não pode impedir a pessoa de ver a vaga.
    try {
      await supabase.from('cliques').insert({ user_id: usuario.id, job_id: jobId });
    } catch {
      // segue para a vaga mesmo assim
    }
  }

  return NextResponse.redirect(vaga.url);
}
