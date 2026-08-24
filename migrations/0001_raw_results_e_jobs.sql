-- 0001 — tabelas base do coletor
-- Aplicar no SQL Editor do Supabase, em ordem numérica.

-- ---------------------------------------------------------------------------
-- raw_results: tudo que a PSE devolveu, cru. Fonte de verdade do Passo 3.
-- Nenhuma coluna aqui é resultado de classificação.
-- ---------------------------------------------------------------------------
create table if not exists public.raw_results (
  id                     bigint generated always as identity primary key,

  -- Chave de dedup: sha256 da URL canônica. UNIQUE é a rede de segurança
  -- contra duas rodadas simultâneas gravando o mesmo resultado.
  url_hash               text        not null unique,
  url_canonica           text        not null,
  url_original           text        not null,

  titulo                 text        not null,
  -- Sinal fraco de propósito: o snippet da PSE é contaminado pela barra lateral
  -- de "vagas similares" da própria página. A extração boa é da página, no Passo 3.
  snippet                text,

  fonte                  text        not null
    check (fonte in ('linkedin_job', 'linkedin_post', 'ats_gupy', 'desconhecida')),
  -- Id nativo: jobId do LinkedIn (crescente, proxy de idade), activity id do
  -- post, id da vaga na Gupy.
  fonte_id               text,

  -- Rastreia qual combinação de busca trouxe o resultado: sem isso não dá para
  -- medir precisão por dork nem desligar um combo que só traz ruído.
  combo_id               text        not null,
  cargo_busca            text        not null,
  modelo_busca           text        not null,
  localizacao_busca      text,

  -- Publicação e coleta são coisas diferentes. Guardar só a segunda perde o
  -- frescor para sempre.
  data_publicacao        timestamptz,
  data_publicacao_origem text        not null default 'desconhecida'
    check (data_publicacao_origem in ('gupy_snippet', 'metatag', 'desconhecida')),
  data_indexacao         timestamptz,
  data_coleta            timestamptz not null default now(),

  posicao_serp           integer,
  payload                jsonb       not null,

  -- Marcado pelo classificador (Passo 3). O coletor sempre grava false.
  processado             boolean     not null default false
);

create index if not exists raw_results_data_coleta_idx  on public.raw_results (data_coleta desc);
create index if not exists raw_results_pendentes_idx    on public.raw_results (processado, data_coleta desc)
  where processado = false;
create index if not exists raw_results_fonte_idx        on public.raw_results (fonte, data_coleta desc);
create index if not exists raw_results_combo_idx        on public.raw_results (combo_id, data_coleta desc);

comment on column public.raw_results.url_hash is
  'sha256 da url_canonica. Chave de deduplicação do coletor.';
comment on column public.raw_results.fonte_id is
  'Id do LinkedIn é monotonicamente crescente: serve de proxy de idade quando não há data_publicacao.';

-- ---------------------------------------------------------------------------
-- jobs: vaga já classificada. O coletor NÃO escreve aqui — o Passo 3 escreve.
-- A tabela existe agora porque a chave de dedup é decisão de schema: adicionar
-- depois custaria migração de dados.
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id                bigint generated always as identity primary key,
  raw_result_id     bigint      references public.raw_results (id) on delete set null,

  -- empresa + cargo normalizado. Sem isso o feed mostra a mesma vaga duas vezes
  -- (uma pela Gupy, outra pelo post) e parece quebrado. Ver chaveDedupVaga().
  dedup_key         text        not null unique,

  empresa           text        not null,
  cargo             text        not null,
  cargo_normalizado text        not null,
  senioridade       text,
  modelo            text        check (modelo in ('remoto', 'hibrido', 'presencial')),
  localizacao       text,

  url               text        not null,
  fonte             text        not null
    check (fonte in ('linkedin_job', 'linkedin_post', 'ats_gupy')),

  descricao         text,
  data_publicacao   timestamptz,
  data_coleta       timestamptz not null default now(),

  classificado_em   timestamptz,
  classificador     text,
  confianca         numeric(3, 2) check (confianca between 0 and 1),
  ativo             boolean     not null default true
);

create index if not exists jobs_feed_idx  on public.jobs (ativo, data_publicacao desc nulls last);
create index if not exists jobs_cargo_idx on public.jobs (cargo_normalizado);
create index if not exists jobs_fonte_idx on public.jobs (fonte);

-- ---------------------------------------------------------------------------
-- collection_runs: uma linha por execução.
-- Existe para responder a pergunta que ainda não foi medida: quantas vagas
-- NOVAS por semana por segmento. Fluxo, não estoque.
-- ---------------------------------------------------------------------------
create table if not exists public.collection_runs (
  id                 bigint generated always as identity primary key,
  iniciado_em        timestamptz not null,
  duracao_ms         integer,
  dia_quota          date        not null,
  queries_planejadas integer     not null default 0,
  queries_consumidas integer     not null default 0,
  itens_brutos       integer     not null default 0,
  duplicados_rodada  integer     not null default 0,
  ja_no_banco        integer     not null default 0,
  novos              integer     not null default 0,
  erros              integer     not null default 0,
  quota_esgotada     boolean     not null default false,
  criado_em          timestamptz not null default now()
);

create index if not exists collection_runs_dia_idx on public.collection_runs (dia_quota desc);

-- ---------------------------------------------------------------------------
-- RLS ligada e sem policy: só a service_role (usada pelo coletor) enxerga.
-- As policies de leitura do feed entram no Passo 4, junto com o Auth.
-- ---------------------------------------------------------------------------
alter table public.raw_results     enable row level security;
alter table public.jobs            enable row level security;
alter table public.collection_runs enable row level security;
