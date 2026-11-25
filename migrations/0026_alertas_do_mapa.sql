-- 0026 — buscas extras no e-mail semanal, configuradas no Mapa.
--
-- O e-mail semanal (0025) manda as vagas novas da busca principal da pessoa
-- (o cargo e a cidade de `perfis`). Quem tem o Mapa pode acrescentar outras
-- buscas — "Analista de Dados em BH", "Product Owner remoto" — e todas chegam
-- NUM e-mail só por semana, uma seção por busca. Um e-mail por busca
-- multiplicaria o envio contra o teto de 100/dia do Resend, que é dividido
-- com o link mágico do login.
--
-- `alertas_email.ativo` continua sendo a chave geral: desligado, nada chega,
-- e o link de descadastro do e-mail desliga tudo de uma vez.
--
-- Teto: 5 buscas extras por pessoa, na policy de insert. Cada par novo entra
-- na coleta diária (scripts/coleta-diaria.ts), e é ali que o custo mora.

create table if not exists public.alertas_email_buscas (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  cargo       text        not null check (char_length(cargo) between 2 and 80),
  cidade      text        not null check (char_length(cidade) between 2 and 80),
  cidade_slug text        not null,
  so_remoto   boolean     not null default false,
  criado_em   timestamptz not null default now()
);

create unique index if not exists alertas_email_buscas_unica_idx
  on public.alertas_email_buscas (user_id, lower(cargo), cidade_slug, so_remoto);

comment on table public.alertas_email_buscas is
  'Buscas extras do e-mail semanal, configuradas no Mapa. A busca principal continua sendo a de perfis.';

alter table public.alertas_email_buscas enable row level security;

drop policy if exists alertas_email_buscas_le on public.alertas_email_buscas;
create policy alertas_email_buscas_le
  on public.alertas_email_buscas for select
  to authenticated
  using (user_id = auth.uid());

-- Sessão anônima fica de fora (não tem e-mail), e o teto de 5 mora aqui para
-- valer também contra quem chamar o PostgREST direto com a chave pública.
drop policy if exists alertas_email_buscas_cria on public.alertas_email_buscas;
create policy alertas_email_buscas_cria
  on public.alertas_email_buscas for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and (select count(*) from public.alertas_email_buscas b where b.user_id = auth.uid()) < 5
  );

drop policy if exists alertas_email_buscas_apaga on public.alertas_email_buscas;
create policy alertas_email_buscas_apaga
  on public.alertas_email_buscas for delete
  to authenticated
  using (user_id = auth.uid());

-- Quantas buscas o envio cobriu. As colunas cargo/cidade/so_remoto de
-- envios_email continuam guardando a busca principal.
alter table public.envios_email add column if not exists buscas integer not null default 1;
