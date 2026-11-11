-- 0021 — O acervo de vagas ativas passa a ser legível sem sessão.
--
-- Motivo: SEO. O Googlebot entra sem sessão (o proxy não cria visitante para
-- robô), e a `jobs_leitura_autenticada` só entrega linha a `authenticated`. O
-- resultado medido em 11/11: a landing que o Google indexa não tem nenhuma vaga,
-- e as páginas públicas por cargo × cidade (`/vagas-de/...`) não teriam o que
-- mostrar.
--
-- O que isto NÃO muda na prática: qualquer pessoa já conseguia ler as mesmas
-- linhas, porque o login anônimo está ligado — `signInAnonymously` com a chave
-- pública devolve um token `authenticated` em uma chamada. A policy nova só
-- tira esse passo do caminho do robô de busca.
--
-- O que continua igual, e é o que importa:
--   - só `ativo = true`. Vaga desativada pelo portão de local ou pelo backfill
--     continua invisível, igual à policy de 0005;
--   - só leitura. Nenhum insert/update/delete para `anon`;
--   - `buscas`, `cliques`, `perfis`, currículos e adaptações não são tocados.
--
-- Idempotente: pode rodar duas vezes.

drop policy if exists jobs_leitura_publica on public.jobs;
create policy jobs_leitura_publica
  on public.jobs for select
  to anon
  using (ativo);

grant select on public.jobs to anon;
revoke insert, update, delete, truncate on public.jobs from anon;
