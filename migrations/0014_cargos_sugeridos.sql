-- 0014 — Cargos sugeridos pelos visitantes, listados na landing.
--
-- A landing mostra os cargos que a coleta diária cobre (pré-carga em
-- `src/config/pre-carga.ts` + esta tabela) e deixa a pessoa sugerir mais. Um
-- cargo sugerido entra na coleta diária nas capitais da pré-carga.
--
-- Duas defesas, porque a lista é PÚBLICA e o texto vem de qualquer visitante:
--
--   1. Só aparece na landing o cargo cuja coleta achou vaga
--      (`vagas_ultima_coleta > 0`). Texto que não é cargo — ofensa, propaganda,
--      teste — não acha vaga na Gupy e nunca é exibido.
--   2. Teto de 3 sugestões por pessoa por dia, checado na policy de insert.
--      Cada cargo vira ~5 pares de InfoJobs na madrugada (1–5 min cada).
--
-- `familia` é calculada no TypeScript (`chaveDeFamilia`), como em `buscas`
-- (0007): "Enfermeira" e "Enfermeiro" são uma sugestão só.

create table if not exists public.cargos_sugeridos (
  id                  bigint      generated always as identity primary key,
  cargo               text        not null check (length(cargo) between 3 and 60),
  familia             text        not null unique,
  sugerido_por        uuid        references auth.users (id) on delete set null,
  criado_em           timestamptz not null default now(),
  -- Preenchidos pela coleta diária (só a Gupy, que roda para todos os pares).
  coletado_em         timestamptz,
  vagas_ultima_coleta integer
);

alter table public.cargos_sugeridos enable row level security;

-- Contagem de sugestões do dia SEM passar pela RLS de leitura (que só mostra as
-- já coletadas com vaga) — senão a policy contaria errado.
create or replace function public.sugestoes_nas_24h(uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.cargos_sugeridos
  where sugerido_por = uid and criado_em > now() - interval '24 hours';
$$;

revoke all on function public.sugestoes_nas_24h(uuid) from public;
grant execute on function public.sugestoes_nas_24h(uuid) to authenticated;

drop policy if exists cargos_sugeridos_leitura on public.cargos_sugeridos;
create policy cargos_sugeridos_leitura
  on public.cargos_sugeridos for select
  to anon, authenticated
  using (vagas_ultima_coleta > 0);

drop policy if exists cargos_sugeridos_insercao on public.cargos_sugeridos;
create policy cargos_sugeridos_insercao
  on public.cargos_sugeridos for insert
  to authenticated
  with check (
    sugerido_por = auth.uid()
    and coletado_em is null
    and vagas_ultima_coleta is null
    and public.sugestoes_nas_24h(auth.uid()) < 3
  );

comment on table public.cargos_sugeridos is
  'Cargos sugeridos na landing. Entram na coleta diária; aparecem na lista pública só depois que a coleta achou vaga.';
