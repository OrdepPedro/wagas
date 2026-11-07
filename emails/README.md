# E-mails do Supabase Auth

Templates com a marca do wagas, para colar em **Supabase → Authentication → Emails → Templates**. Gerados a partir de um layout único por `gerar.mjs`: para mudar texto ou cor, edite o script e rode `node emails/gerar.mjs emails/supabase`. Não edite os HTML à mão, senão o próximo `gerar` apaga a mudança.

| Template no Supabase | Arquivo | Assunto |
|---|---|---|
| Magic Link | `supabase/magic-link.html` | Seu link para entrar no wagas |
| Confirm signup | `supabase/confirmar-cadastro.html` | Confirme seu e-mail no wagas |
| Change Email Address | `supabase/trocar-email.html` | Confirme seu novo e-mail no wagas |
| Invite user | `supabase/convite.html` | Seu convite para o wagas |

Só os dois primeiros saem hoje: `signInWithOtp` manda o **Confirm signup** no primeiro acesso de um e-mail e o **Magic Link** nos seguintes. Reset Password e Reauthentication ficaram de fora porque o site não tem senha.

## O link mudou de formato

Os templates não usam `{{ .ConfirmationURL }}`. O link é:

    {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email

O `/auth/callback` já trata essa forma (`verifyOtp` no servidor). A diferença importa: o fluxo padrão (PKCE) só funciona no mesmo navegador em que a pessoa pediu o link, porque depende de um cookie dele. Quem pede no computador e abre o e-mail no celular, ou no navegador interno do app do Gmail, cai em `/entrar?erro=link`. Com `token_hash`, funciona em qualquer navegador.

Por isso o **Site URL** do Supabase precisa continuar `https://www.wagas.com.br`. Em desenvolvimento local, o link do e-mail leva para produção.

## Logo

`web/public/email/logo-wagas.png` (1209×300, exibido a 129×32), servido em `https://www.wagas.com.br/email/logo-wagas.png`. **Só existe depois do deploy deste branch.** Colar os templates antes disso mostra o texto alternativo "wagas" no lugar do logo.

É PNG porque Gmail e Outlook não exibem SVG. A versão é a clara do logo (ícone `#6E9EFF`, nome `#F2F4F8`) sobre uma faixa `#0F1220`, a mesma do ícone do app. Faixa escura no topo sobrevive ao modo escuro dos clientes de e-mail; logo escuro em fundo transparente sumiria.

## O que não foi verificado

- Renderização real em Gmail, Outlook e Apple Mail. A conferência foi no navegador, em desktop e em largura de celular.
- "Vale por 1 hora" é o padrão do Supabase (Email OTP Expiration = 3600 s). Se o valor do projeto for outro, o texto está errado.
