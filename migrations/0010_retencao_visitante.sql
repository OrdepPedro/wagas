-- 0010 — Retenção do visitante anônimo (LGPD), decidida pelo Pedro em 23/10/2026.
--
-- Visitante sem acesso há 30 dias deixa de existir: a conta anônima é apagada,
-- e com ela o perfil (cascade) e a sessão. O que ele buscou e clicou FICA, mas
-- sem `user_id` — anonimizado. Dado anonimizado sai do escopo da LGPD, e é
-- exatamente o que a fila de demanda e a contagem de cliques precisam.
--
-- Por que 30 e não 7: apagar em 7 dias faria quem volta no 8º dia aparecer como
-- pessoa nova, e a retenção no dia 7 — a métrica que decide o Passo 5 —
-- deixaria de ser medível.
--
-- Só `is_anonymous`. Conta com e-mail nunca é tocada por esta função.

alter table public.buscas  alter column user_id drop not null;
alter table public.cliques alter column user_id drop not null;

alter table public.buscas drop constraint if exists buscas_user_id_fkey;
alter table public.buscas
  add constraint buscas_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

alter table public.cliques drop constraint if exists cliques_user_id_fkey;
alter table public.cliques
  add constraint cliques_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- Último acesso = o mais recente entre criação, login, renovação de sessão,
-- busca e clique. A renovação conta porque o visitante que só abre o feed salvo
-- (sem buscar nada) também está usando o produto.
create or replace function public.limpar_visitantes(dias integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  apagados integer;
begin
  if dias < 30 then
    raise exception 'retenção mínima do visitante é 30 dias (pedido: %)', dias;
  end if;

  with ultimo_acesso as (
    select
      u.id,
      greatest(
        u.created_at,
        coalesce(u.last_sign_in_at, u.created_at),
        coalesce((select max(greatest(s.updated_at, s.refreshed_at))::timestamptz
                    from auth.sessions s where s.user_id = u.id), u.created_at),
        coalesce((select max(b.criado_em) from public.buscas  b where b.user_id = u.id), u.created_at),
        coalesce((select max(c.criado_em) from public.cliques c where c.user_id = u.id), u.created_at)
      ) as em
    from auth.users u
    where u.is_anonymous
  ),
  removidos as (
    delete from auth.users u
    using ultimo_acesso a
    where u.id = a.id
      and a.em < now() - make_interval(days => dias)
    returning u.id
  )
  select count(*) into apagados from removidos;

  return apagados;
end;
$$;

revoke execute on function public.limpar_visitantes(integer) from public, anon, authenticated;
grant  execute on function public.limpar_visitantes(integer) to service_role;

comment on function public.limpar_visitantes(integer) is
  'Apaga visitantes anônimos sem acesso há N dias (mínimo 30); buscas e cliques ficam anonimizados. Roda na coleta diária.';
