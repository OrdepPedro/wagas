// Gera os templates do Supabase Auth a partir de um layout só.
// Uso: node emails/gerar.mjs emails/supabase
import { writeFileSync, mkdirSync } from 'node:fs';

const destino = process.argv[2];
mkdirSync(destino, { recursive: true });

const LOGO = 'https://www.wagas.com.br/email/logo-wagas.png';

function layout({ previa, titulo, corpo, botao, link, nota }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${titulo}</title>
</head>
<body style="margin:0; padding:0; background-color:#f6f8fc;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#f6f8fc;">${previa}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f6f8fc;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td align="left" style="background-color:#0f1220; border-radius:10px 10px 0 0; padding:20px 32px;">
            <a href="{{ .SiteURL }}" style="text-decoration:none;">
              <img src="${LOGO}" width="129" height="32" alt="wagas" style="display:block; border:0; outline:none; height:32px; width:129px; color:#f2f4f8; font-family:ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; font-size:24px; font-weight:700;">
            </a>
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff; border:1px solid #dfe6f1; border-top:0; border-radius:0 0 10px 10px; padding:32px; font-family:ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;">
            <h1 style="margin:0 0 12px; font-size:22px; line-height:1.3; font-weight:700; color:#0f1b2d;">${titulo}</h1>
${corpo.map((p) => `            <p style="margin:0 0 16px; font-size:16px; line-height:1.55; color:#0f1b2d;">${p}</p>`).join('\n')}
${botao ? `            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
              <tr>
                <td align="center" bgcolor="#1d4ed8" style="border-radius:10px; background-color:#1d4ed8;">
                  <a href="${link}" target="_blank" style="display:inline-block; padding:14px 28px; font-size:16px; font-weight:600; line-height:1; color:#ffffff; text-decoration:none; border-radius:10px;">${botao}</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px; font-size:13px; line-height:1.5; color:#5a6a80;">Se o botão não abrir, copie e cole este endereço no navegador:</p>
            <p style="margin:0 0 24px; font-size:13px; line-height:1.5; word-break:break-all;"><a href="${link}" style="color:#1d4ed8; text-decoration:underline;">${link}</a></p>` : ''}
            <p style="margin:0; padding-top:20px; border-top:1px solid #dfe6f1; font-size:13px; line-height:1.5; color:#5a6a80;">${nota}</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 16px 0; font-family:ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; font-size:12px; line-height:1.5; color:#5a6a80;">
            wagas · vagas dos últimos 7 dias para o seu cargo e a sua cidade<br>
            <a href="{{ .SiteURL }}" style="color:#5a6a80; text-decoration:underline;">wagas.com.br</a> · <a href="{{ .SiteURL }}/privacidade" style="color:#5a6a80; text-decoration:underline;">Privacidade</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

// O link volta pelo /auth/callback com token_hash, verificado no servidor
// (web/app/auth/callback/route.ts). Ao contrário do {{ .ConfirmationURL }} com
// PKCE, funciona quando a pessoa abre o e-mail em outro navegador ou no app do
// Gmail, onde o cookie do code_verifier não existe.
const cb = (tipo) => `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=${tipo}`;

const naoFoiVoce =
  'Pedido feito para {{ .Email }}. Se não foi você, ignore este e-mail: ninguém entra na sua conta sem clicar no link.';

const templates = {
  'magic-link.html': layout({
    previa: 'Seu link para entrar no wagas. Vale por 1 hora.',
    titulo: 'Entre no wagas',
    corpo: ['Clique no botão para entrar. O link vale por 1 hora e só funciona uma vez.'],
    botao: 'Entrar no wagas',
    link: cb('email'),
    nota: naoFoiVoce,
  }),
  'confirmar-cadastro.html': layout({
    previa: 'Confirme seu e-mail e veja as vagas da semana.',
    titulo: 'Falta um clique',
    corpo: [
      'Confirme seu e-mail para ver as vagas dos últimos 7 dias para o seu cargo e a sua cidade.',
      'O link vale por 1 hora e só funciona uma vez.',
    ],
    botao: 'Confirmar e entrar',
    link: cb('email'),
    nota: naoFoiVoce,
  }),
  'trocar-email.html': layout({
    previa: 'Confirme o novo e-mail da sua conta no wagas.',
    titulo: 'Confirme seu novo e-mail',
    corpo: [
      'Você pediu para trocar o e-mail da sua conta de <strong>{{ .Email }}</strong> para <strong>{{ .NewEmail }}</strong>.',
      'A troca só vale depois que você confirmar.',
    ],
    botao: 'Confirmar novo e-mail',
    link: cb('email_change'),
    nota: 'Se não foi você que pediu a troca, ignore este e-mail: sua conta continua com o e-mail atual.',
  }),
  'convite.html': layout({
    previa: 'Seu convite para o wagas.',
    titulo: 'Seu convite para o wagas',
    corpo: [
      'Você recebeu um convite para o wagas: as vagas dos últimos 7 dias para o seu cargo e a sua cidade, num lugar só.',
    ],
    botao: 'Aceitar convite',
    link: cb('invite'),
    nota: 'Convite enviado para {{ .Email }}. Se você não esperava por ele, ignore este e-mail.',
  }),
};

for (const [nome, html] of Object.entries(templates)) writeFileSync(`${destino}/${nome}`, html);
console.log(Object.keys(templates).join(', '));
