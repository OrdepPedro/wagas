-- 0023 — Mapa: gerenciamento de candidaturas (decidido pelo Pedro em 16–17/11/2026).
--
-- Funcionalidade a mais, paga, com teste de 3 dias sem cartão. O feed continua
-- gratuito e não depende de nada aqui. Só conta com e-mail: visitante anônimo
-- é apagado em 30 dias (0010) e perderia as candidaturas.
--
-- Tudo `if not exists` / `drop policy if exists`: rodar de novo não muda nada.

-- ---------------------------------------------------------------------------
-- mapa_acessos: quando o teste começou e até quando a pessoa pagou.
--
-- Separada do perfil de propósito. O perfil a pessoa edita; se o início do
-- teste morasse lá, bastaria um update pelo PostgREST para recomeçá-lo. Aqui
-- ela só LÊ e INSERE uma vez: sem update, sem delete, e o insert só passa com
-- `trial_inicio` de agora e `pago_ate` vazio. Quem grava `pago_ate` é o
-- servidor, com a chave secreta, quando houver pagamento.
-- ---------------------------------------------------------------------------
create table if not exists public.mapa_acessos (
  user_id      uuid        primary key references auth.users (id) on delete cascade,
  trial_inicio timestamptz not null default now(),
  pago_ate     timestamptz
);

alter table public.mapa_acessos enable row level security;

drop policy if exists mapa_acessos_leitura on public.mapa_acessos;
create policy mapa_acessos_leitura
  on public.mapa_acessos for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists mapa_acessos_inicio on public.mapa_acessos;
create policy mapa_acessos_inicio
  on public.mapa_acessos for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and pago_ate is null
    and trial_inicio between now() - interval '1 minute' and now() + interval '1 minute'
  );

revoke update, delete, truncate on public.mapa_acessos from anon, authenticated;

-- ---------------------------------------------------------------------------
-- mapa_perfis: os filtros da pessoa. Cargo e cidade continuam em `perfis`.
--
-- `pretensao` é quanto ela quer ganhar, em reais por mês. Guardada desde já;
-- nenhuma vaga é cortada por ela enquanto `jobs` não tiver salário.
-- ---------------------------------------------------------------------------
create table if not exists public.mapa_perfis (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  nivel         text        check (nivel in ('estagio', 'junior', 'pleno', 'senior', 'principal')),
  modelos       text[]      not null default '{}' check (modelos <@ array['presencial', 'hibrido', 'remoto']),
  contrato      text        not null default 'tanto_faz' check (contrato in ('tanto_faz', 'clt', 'pj')),
  pretensao     integer     check (pretensao between 100 and 200000),
  atualizado_em timestamptz not null default now()
);

alter table public.mapa_perfis enable row level security;

drop policy if exists mapa_perfis_dono on public.mapa_perfis;
create policy mapa_perfis_dono
  on public.mapa_perfis for all
  to authenticated
  using (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false))
  with check (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

-- ---------------------------------------------------------------------------
-- candidaturas: o que a pessoa enviou. O Mapa não se candidata por ninguém.
--
-- Cargo, empresa e link são COPIADOS da vaga: a vaga sai da janela de 7 dias e
-- pode ser apagada, e a candidatura precisa continuar legível. Por isso
-- `job_id` é `on delete set null`, e vazio na inserção manual.
--
-- `nao_enviada` é a resposta "não" à pergunta "você se candidatou?". Fica
-- gravada para a pergunta não se repetir; a tela não a lista.
--
-- A unicidade por (pessoa, vaga) é a regra do produto: a mesma vaga não entra
-- duas vezes.
-- ---------------------------------------------------------------------------
create table if not exists public.candidaturas (
  id            bigint      generated always as identity primary key,
  user_id       uuid        not null references auth.users (id) on delete cascade,
  job_id        bigint      references public.jobs (id) on delete set null,
  cargo         text        not null check (length(cargo) between 2 and 200),
  empresa       text        not null check (length(empresa) between 2 and 200),
  url           text        check (url is null or length(url) <= 2000),
  status        text        not null default 'enviada'
                check (status in ('enviada', 'aguardando', 'entrevista', 'proposta', 'recusada', 'nao_enviada')),
  -- `feed` (botão no cartão), `pergunta` (resposta ao "você se candidatou?") ou `manual`.
  origem        text        not null check (origem in ('feed', 'pergunta', 'manual')),
  enviada_em    date        not null default current_date,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists candidaturas_uma_por_vaga_idx
  on public.candidaturas (user_id, job_id) where job_id is not null;
create index if not exists candidaturas_usuario_idx on public.candidaturas (user_id, enviada_em desc);

alter table public.candidaturas enable row level security;

drop policy if exists candidaturas_dono on public.candidaturas;
create policy candidaturas_dono
  on public.candidaturas for all
  to authenticated
  using (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false))
  with check (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));
