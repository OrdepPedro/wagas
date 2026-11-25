-- 0025 — e-mail semanal de vagas novas (Passo 5, gatilho de retorno).
--
-- Três tabelas:
--   alertas_email  quem pediu, com o consentimento datado (LGPD) e o token de
--                  descadastro que vai em cada e-mail.
--   envios_email   um registro por e-mail enviado. É o denominador da métrica.
--   cliques_email  clique num link do e-mail. Separado de `cliques` porque quem
--                  abre o e-mail no celular não tem a sessão do site: sem isto,
--                  o clique que o e-mail trouxe sumiria ou cairia sem dono.
--
-- A métrica que decide se o gatilho funciona: envios com pelo menos um clique,
-- sobre envios. Ela sai do join das duas últimas.

create table if not exists public.alertas_email (
  user_id        uuid        primary key references auth.users (id) on delete cascade,
  ativo          boolean     not null default true,
  consentido_em  timestamptz not null default now(),
  desativado_em  timestamptz,
  -- Vai no link "parar de receber". Não é segredo forte: o pior que alguém com
  -- ele faz é descadastrar a pessoa, que é o que o link existe para fazer.
  descadastro    uuid        not null unique default gen_random_uuid()
);

comment on table public.alertas_email is
  'Opt-in do e-mail semanal. Só conta com e-mail; visitante anônimo não tem para onde mandar.';

alter table public.alertas_email enable row level security;

-- A pessoa lê, liga e desliga o próprio alerta. Sessão anônima fica de fora
-- pelo mesmo critério do Mapa (0024).
drop policy if exists alertas_email_le on public.alertas_email;
create policy alertas_email_le
  on public.alertas_email for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists alertas_email_cria on public.alertas_email;
create policy alertas_email_cria
  on public.alertas_email for insert
  to authenticated
  with check (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

drop policy if exists alertas_email_altera on public.alertas_email;
create policy alertas_email_altera
  on public.alertas_email for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.envios_email (
  -- Gerado pelo script antes do envio: vai nos links do próprio e-mail.
  id         uuid        primary key,
  user_id    uuid        references auth.users (id) on delete set null,
  enviado_em timestamptz not null default now(),
  cargo      text        not null,
  cidade     text        not null,
  so_remoto  boolean     not null default false,
  -- Novas desde o envio anterior; o corpo mostra no máximo 10.
  vagas      integer     not null,
  job_ids    bigint[]    not null default '{}',
  resend_id  text
);

create index if not exists envios_email_por_usuario_idx on public.envios_email (user_id, enviado_em desc);

-- Só o script (chave secreta) escreve e lê.
alter table public.envios_email enable row level security;

create table if not exists public.cliques_email (
  id        bigint      generated always as identity primary key,
  envio_id  uuid        not null references public.envios_email (id) on delete cascade,
  job_id    bigint      not null references public.jobs (id) on delete cascade,
  criado_em timestamptz not null default now()
);

create index if not exists cliques_email_por_envio_idx on public.cliques_email (envio_id);

-- Quem grava é a rota /ir, com a chave secreta, depois de conferir que o
-- envio existe e que a vaga estava nele.
alter table public.cliques_email enable row level security;

-- Cliques contados POR ENVIO primeiro, e só depois agrupados por semana: somar
-- direto no agrupamento por semana exigiria subconsulta correlacionada com a
-- coluna agrupada, que o Postgres recusa (42803).
create or replace view public.email_conversao
with (security_invoker = true) as
with por_envio as (
  select
    date_trunc('week', e.enviado_em) as semana,
    (select count(*) from public.cliques_email c where c.envio_id = e.id) as cliques
  from public.envios_email e
)
select
  semana,
  count(*)                              as envios,
  count(*) filter (where cliques > 0)   as envios_com_clique,
  coalesce(sum(cliques), 0)::bigint     as cliques
from por_envio
group by semana
order by semana desc;
