-- 0002 — controle de saldo de API
--
-- Substitui a antiga `pse_quota`. Aquela tabela tinha `dia date` como chave,
-- porque a cota da Custom Search API zerava à meia-noite do Pacífico. A Serper
-- não funciona assim: os créditos são um SALDO ÚNICO que não renova.
--
-- Chave textual resolve os dois casos:
--   'serper'          -> saldo acumulado, nunca zera
--   'pse:2026-08-22'  -> cota por dia, se algum dia voltar a existir cota diária
--
-- O runner do GitHub Actions é efêmero: o contador não pode viver em disco lá.
-- O Postgres é a única fonte de verdade compartilhada entre execuções.
--
-- Modelo de reserva: a rodada reserva ANTES de disparar qualquer chamada e
-- devolve o que não usou. Incrementar depois abriria janela para duas execuções
-- simultâneas estourarem o saldo.

create table if not exists public.api_saldo (
  chave         text        primary key,
  consumidos    integer     not null default 0 check (consumidos >= 0),
  limite        integer     not null check (limite > 0),
  atualizado_em timestamptz not null default now(),

  constraint api_saldo_dentro_do_limite check (consumidos <= limite)
);

comment on table public.api_saldo is
  'Saldo de créditos por API. Chave "serper" é acumulada e não renova.';

-- ---------------------------------------------------------------------------
-- Reserva atômica. Retorna quantos créditos foram concedidos (0..p_pedidos).
-- SELECT ... FOR UPDATE serializa execuções concorrentes na linha da chave.
-- ---------------------------------------------------------------------------
create or replace function public.reservar_saldo(
  p_chave   text,
  p_pedidos integer,
  p_limite  integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumidos integer;
  v_limite     integer;
  v_concedidos integer;
begin
  if p_pedidos <= 0 then
    return 0;
  end if;

  insert into public.api_saldo (chave, consumidos, limite)
  values (p_chave, 0, p_limite)
  on conflict (chave) do nothing;

  select consumidos, limite
    into v_consumidos, v_limite
    from public.api_saldo
   where chave = p_chave
     for update;

  v_concedidos := greatest(least(p_pedidos, v_limite - v_consumidos), 0);

  if v_concedidos > 0 then
    update public.api_saldo
       set consumidos    = consumidos + v_concedidos,
           atualizado_em = now()
     where chave = p_chave;
  end if;

  return v_concedidos;
end;
$$;

-- ---------------------------------------------------------------------------
-- Devolve créditos reservados e não usados (rodada truncada, erro de rede).
-- ---------------------------------------------------------------------------
create or replace function public.devolver_saldo(
  p_chave      text,
  p_devolvidos integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumidos integer;
begin
  if p_devolvidos <= 0 then
    return 0;
  end if;

  update public.api_saldo
     set consumidos    = greatest(consumidos - p_devolvidos, 0),
         atualizado_em = now()
   where chave = p_chave
  returning consumidos into v_consumidos;

  return coalesce(v_consumidos, 0);
end;
$$;

alter table public.api_saldo enable row level security;

revoke execute on function public.reservar_saldo(text, integer, integer) from anon, authenticated;
revoke execute on function public.devolver_saldo(text, integer)          from anon, authenticated;
