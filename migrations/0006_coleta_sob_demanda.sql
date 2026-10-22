-- 0006 — coleta sob demanda pela API pública da Gupy
--
-- O Passo 4 fechou com o feed vazio para qualquer cargo fora da varredura da
-- Serper. A saída não foi gastar crédito no request do usuário: foi uma fonte
-- gratuita, brasileira e sem chave — a API que o próprio portal da Gupy usa.
--
-- Ela muda a natureza do dado que entra, e é por isso que precisa de migration:
-- a data de publicação passa a vir da API, com timestamp exato, e não do texto
-- do snippet. Registrar as duas com a mesma procedência apagaria justamente a
-- diferença de qualidade entre elas.

-- ---------------------------------------------------------------------------
-- Procedência nova: 'gupy_api'.
--
-- 'gupy_snippet' é a data lida do texto que o Google indexou — existe em 16%
-- dos resultados e depende de a Gupy escrever a frase na página.
-- 'gupy_api' é o campo `publishedDate`, com hora e minuto, em 100% dos itens.
-- ---------------------------------------------------------------------------
alter table public.raw_results drop constraint if exists raw_results_data_publicacao_origem_check;
alter table public.raw_results
  add constraint raw_results_data_publicacao_origem_check
  check (data_publicacao_origem in ('gupy_snippet', 'gupy_api', 'metatag', 'desconhecida'));

alter table public.jobs drop constraint if exists jobs_origem_data_valida;
alter table public.jobs
  add constraint jobs_origem_data_valida
  check (data_publicacao_origem in ('gupy_snippet', 'gupy_api', 'metatag', 'desconhecida'));

-- ---------------------------------------------------------------------------
-- Controle de frescor da coleta sob demanda.
--
-- A premissa do produto passou a ser: nova consulta sempre que o usuário trocar
-- de cargo ou de cidade. Sem um registro do que já foi buscado e quando, dez
-- usuários pedindo "Auxiliar Administrativo em São Paulo" na mesma manhã viram
-- dez varreduras da fonte externa — pelo mesmo dado.
--
-- É a mesma economia da regra crítica do CLAUDE.md, aplicada a uma fonte que
-- não custa dinheiro mas custa educação: o custo escala com pares cargo×cidade
-- distintos, não com número de usuários.
--
-- A chave é (cargo normalizado, cidade, só-remoto) porque as três mudam o
-- resultado da consulta. `cargo_chave` guarda a forma normalizada, não o que o
-- usuário digitou: "Enfermeiro" e "enfermeiro " são a mesma coleta.
-- ---------------------------------------------------------------------------
create table if not exists public.coletas_sob_demanda (
  cargo_chave     text        not null,
  cidade_slug     text        not null,
  so_remoto       boolean     not null default false,
  fonte           text        not null default 'gupy_api',
  ultima_coleta   timestamptz not null default now(),
  itens_vistos    integer     not null default 0,
  itens_gravados  integer     not null default 0,
  execucoes       integer     not null default 1,

  primary key (cargo_chave, cidade_slug, so_remoto, fonte)
);

comment on table public.coletas_sob_demanda is
  'Quando cada par cargo x cidade foi buscado na fonte sob demanda. Evita repetir a mesma varredura por usuário.';

create index if not exists coletas_recentes_idx
  on public.coletas_sob_demanda (ultima_coleta desc);

-- Só o servidor escreve aqui, com a chave secreta. Sem policy: a chave pública
-- do front não enxerga nem grava.
alter table public.coletas_sob_demanda enable row level security;

-- ---------------------------------------------------------------------------
-- `local_avaliado` ganha um segundo caminho.
--
-- Ela nasceu marcando "o portão de local do classificador julgou esta vaga",
-- para separar as 197 linhas anteriores ao portão. A fonte sob demanda não passa
-- por LLM nenhum: ela compara cidade e modelo de trabalho vindos de campo
-- ESTRUTURADO, que é um julgamento mais forte, não mais fraco. O comentário
-- passa a dizer isso, senão a coluna vira mentira por omissão.
-- ---------------------------------------------------------------------------
comment on column public.jobs.local_avaliado is
  'true = o local foi julgado, pelo portão do LLM ou por campo estruturado da fonte. false = linha anterior ao portão.';
