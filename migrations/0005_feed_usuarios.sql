-- 0005 — o lado do usuário: perfil, demanda e clique
--
-- A migration 0001 deixou RLS ligada e sem policy em `jobs`, com o bilhete de
-- que "as policies de leitura do feed entram no Passo 4, junto com o Auth".
-- É aqui.
--
-- Três tabelas, e nenhuma delas é opcional:
--
--   perfis   o par cargo × cidade do usuário. Sem ele o feed não existe na
--            segunda visita, e retenção no dia 7 não é mensurável.
--   buscas   uma linha por carga de feed, COM a contagem de resultados. É de
--            onde sai a demanda descoberta (resultado = 0) sem precisar de uma
--            tabela separada só para o vazio.
--   cliques  a métrica que importa. O CLAUDE.md é explícito: não é vaga
--            coletada, é clique em "ver vaga" por usuário por semana.

-- ---------------------------------------------------------------------------
-- Leitura do feed.
--
-- `using` em vez de dar a tabela inteira: vaga inativa é vaga que o portão de
-- local ou o backfill tirou de circulação, e ela continua no banco de propósito
-- para o harness poder auditar. Não pode vazar para o feed por descuido de
-- consulta.
-- ---------------------------------------------------------------------------
drop policy if exists jobs_leitura_autenticada on public.jobs;
create policy jobs_leitura_autenticada
  on public.jobs for select
  to authenticated
  using (ativo);

-- ---------------------------------------------------------------------------
-- perfis
--
-- Um usuário, um par cargo × cidade. Não é limitação técnica: a premissa do
-- produto é "o usuário informa cargo e cidade", singular. Múltiplas buscas por
-- usuário são desenho de tier pago, e não existe ainda.
-- ---------------------------------------------------------------------------
create table if not exists public.perfis (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  cargo         text        not null check (length(trim(cargo)) between 2 and 80),
  cidade        text        not null check (length(trim(cidade)) between 2 and 80),
  -- Slug gravado, não derivado na consulta: é a MESMA chave que `jobs.cidade_slug`
  -- e quem a produz é `slugCidade()`. Recalcular no SQL abriria a porta para as
  -- duas normalizações discordarem, que é o modo de falha de feed vazio.
  cidade_slug   text        not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.perfis enable row level security;

drop policy if exists perfis_dono on public.perfis;
create policy perfis_dono
  on public.perfis for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- buscas
--
-- `resultados` é a coluna que faz esta tabela valer a pena. Com ela, "quantas
-- pessoas pediram um par que não cobrimos" é um `where resultados = 0`, e
-- "quantas vagas o feed entregou por visita" sai da mesma linha. Sem ela seria
-- preciso uma tabela de demanda separada, que discordaria desta na primeira
-- semana.
-- ---------------------------------------------------------------------------
create table if not exists public.buscas (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  cargo       text        not null,
  cidade      text        not null,
  cidade_slug text        not null,
  resultados  integer     not null,
  criado_em   timestamptz not null default now()
);

create index if not exists buscas_descobertas_idx
  on public.buscas (cidade_slug, criado_em desc)
  where resultados = 0;

alter table public.buscas enable row level security;

drop policy if exists buscas_dono on public.buscas;
create policy buscas_dono
  on public.buscas for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- cliques
--
-- Sem unique: clicar duas vezes na mesma vaga é comportamento, não erro de
-- gravação. A desduplicação, se um dia importar, é decisão de análise e se faz
-- na leitura — apagar o segundo clique aqui perderia a informação para sempre.
-- ---------------------------------------------------------------------------
create table if not exists public.cliques (
  id        bigint      generated always as identity primary key,
  user_id   uuid        not null references auth.users (id) on delete cascade,
  job_id    bigint      not null references public.jobs (id) on delete cascade,
  criado_em timestamptz not null default now()
);

create index if not exists cliques_por_usuario_idx on public.cliques (user_id, criado_em desc);
create index if not exists cliques_por_vaga_idx    on public.cliques (job_id);

alter table public.cliques enable row level security;

drop policy if exists cliques_dono on public.cliques;
create policy cliques_dono
  on public.cliques for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- A fila de priorização da coleta.
--
-- O custo do produto escala com pares cargo × cidade distintos, não com número
-- de usuários (CLAUDE.md). Esta view ordena exatamente por isso: quantas
-- pessoas DIFERENTES pediram um par que o cache não cobre. É a conta que decide
-- onde gastar os créditos da Serper que restam.
-- ---------------------------------------------------------------------------
create or replace view public.demanda_descoberta as
select
  lower(trim(cargo))          as cargo,
  cidade_slug,
  count(distinct user_id)     as pessoas,
  count(*)                    as pedidos,
  min(criado_em)              as primeiro_pedido,
  max(criado_em)              as ultimo_pedido
from public.buscas
where resultados = 0
group by 1, 2
order by pessoas desc, pedidos desc;

comment on view public.demanda_descoberta is
  'Pares cargo x cidade pedidos e não cobertos, ordenados por pessoas distintas. Fila de priorização da coleta.';
