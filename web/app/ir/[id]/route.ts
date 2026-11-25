import { NextResponse } from 'next/server';
import { UUID } from '../../../../src/email/semanal.ts';
import { clienteAdministrativo } from '../../../lib/admin.ts';
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
  requisicao: Request,
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

  // Clique vindo do e-mail semanal (migration 0025). Quem abre o e-mail no
  // celular não tem a sessão do site, então o envio é que diz de quem é. Só
  // conta se o envio existe e a vaga estava nele: `?envio=` inventado não vira
  // clique.
  const envio = new URL(requisicao.url).searchParams.get('envio') ?? '';
  if (UUID.test(envio)) {
    try {
      const db = clienteAdministrativo();
      const [registro] = await db.select<{ id: string }>(
        'envios_email',
        `select=id&id=eq.${envio}&job_ids=cs.{${jobId}}&limit=1`,
      );
      if (registro) await db.insert('cliques_email', [{ envio_id: envio, job_id: jobId }]);
    } catch {
      // segue para a vaga mesmo assim
    }
  }

  return NextResponse.redirect(vaga.url);
}
