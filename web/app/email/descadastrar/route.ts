import { UUID } from '../../../../src/email/semanal.ts';
import { clienteAdministrativo } from '../../../lib/admin.ts';

/**
 * Parar de receber o e-mail semanal, sem login.
 *
 * GET mostra um botão; só o POST descadastra. Filtro antivírus de e-mail
 * corporativo abre todo link da mensagem com GET para inspecionar, e
 * descadastrar no GET tiraria da lista quem nunca pediu para sair.
 *
 * O POST também atende o descadastro de um clique do Gmail
 * (`List-Unsubscribe-Post`), que manda POST direto para este endereço.
 *
 * O token é a autorização: grava com a chave secreta, filtrando por ele.
 */
function pagina(corpo: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>wagas — e-mail semanal</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#111827">${corpo}
<p style="margin-top:32px"><a href="/">wagas</a></p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function token(requisicao: Request): string | null {
  const t = new URL(requisicao.url).searchParams.get('t') ?? '';
  return UUID.test(t) ? t : null;
}

export async function GET(requisicao: Request) {
  const t = token(requisicao);
  if (!t) return pagina('<p>Esse link não é válido.</p>', 400);
  return pagina(`<h1 style="font-size:20px">Parar de receber as vagas por e-mail?</h1>
<form method="post" action="/email/descadastrar?t=${t}"><button type="submit" style="padding:10px 16px">Parar de receber</button></form>`);
}

export async function POST(requisicao: Request) {
  const t = token(requisicao);
  if (!t) return pagina('<p>Esse link não é válido.</p>', 400);
  try {
    await clienteAdministrativo().update('alertas_email', `descadastro=eq.${t}`, {
      ativo: false,
      desativado_em: new Date().toISOString(),
    });
  } catch {
    return pagina('<p>Não consegui concluir agora. Tente de novo em alguns minutos.</p>', 503);
  }
  return pagina(
    '<h1 style="font-size:20px">Pronto, você não recebe mais.</h1><p>Para voltar a receber, é só ligar de novo no seu feed.</p>',
  );
}
