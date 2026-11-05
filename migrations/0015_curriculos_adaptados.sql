-- 0015 — Currículo adaptado à vaga (diferencial redefinido em 19/10/2026).
--
-- Escrita como 0013 numa árvore atrasada e já APLICADA no banco com esse
-- número em 03/11. Renumerada ao entrar no main, que já tinha 0012 e 0013. Tudo
-- aqui é `if not exists` / `create or replace`: rodar de novo não muda nada.
--
-- Currículo é dado pessoal (CLAUDE.md), então o desenho de LGPD vem junto com a
-- primeira linha, não depois. Decidido pelo Pedro em 03/11:
--
--   * o CV fica SALVO, com consentimento explícito gravado — colar uma vez e
--     adaptar para N vagas é o "sem copiar e colar" que separa o produto do
--     ChatGPT grátis;
--   * só conta com e-mail tem CV. Visitante anônimo é apagado em 30 dias
--     (0010) e não tem titular identificável para pedir exclusão;
--   * o CV vai ao Groq, não ao Gemini gratuito: os termos do tier gratuito do
--     Gemini permitem uso do conteúdo para melhorar produtos, com revisão
--     humana. O Groq, por padrão, não retém conteúdo de inferência.
--
-- "Apagar meu currículo" apaga a linha de `curriculos` e zera `resultado` das
-- adaptações. A linha da adaptação fica, sem conteúdo: é a métrica do
-- diferencial (CV gerado → clique em "ver vaga"), e sem o texto ela deixa de
-- ser dado de currículo.

create table if not exists public.curriculos (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  texto         text        not null check (length(texto) between 200 and 20000),
  -- `pdf` (arquivo: PDF ou DOCX, pelo leitor do medidor) ou `texto` (colado).
  -- Se o extraído sai pior que o colado, é aqui que aparece.
  origem        text        not null check (origem in ('pdf', 'texto')),
  consentido_em timestamptz not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.curriculos enable row level security;

drop policy if exists curriculos_dono on public.curriculos;
create policy curriculos_dono
  on public.curriculos for all
  to authenticated
  using (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false))
  with check (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

-- ---------------------------------------------------------------------------
-- adaptacoes: uma linha por tentativa, com sucesso ou não.
--
-- A falha também é gravada (`ok = false`, `erro`): taxa de falha do provedor é
-- o primeiro número a olhar, e sem a linha ela não existe. Só as que deram
-- certo contam para o teto diário.
--
-- `curriculo_hash` faz a adaptação guardada valer só para o CV que a gerou:
-- trocou o CV, a mesma vaga pede adaptação nova.
-- ---------------------------------------------------------------------------
create table if not exists public.adaptacoes (
  id             bigint      generated always as identity primary key,
  user_id        uuid        references auth.users (id) on delete set null,
  job_id         bigint      references public.jobs (id) on delete set null,
  curriculo_hash text        not null,
  ok             boolean     not null,
  -- O CV adaptado (JSON). Null depois de "apagar meu currículo".
  resultado      jsonb,
  -- Quantos trechos `verificarFidelidade` acusou: empresa ou número fora do CV.
  -- É a medida de quanto o modelo inventa — o modo de falha mais caro da feature.
  alertas        integer,
  provedor       text,
  duracao_ms     integer,
  erro           text,
  criado_em      timestamptz not null default now()
);

create index if not exists adaptacoes_usuario_idx on public.adaptacoes (user_id, criado_em desc);
create index if not exists adaptacoes_vaga_idx on public.adaptacoes (user_id, job_id, curriculo_hash) where ok;

alter table public.adaptacoes enable row level security;

drop policy if exists adaptacoes_dono on public.adaptacoes;
create policy adaptacoes_dono
  on public.adaptacoes for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- A métrica do diferencial: depois de gerar o CV, a pessoa foi para a vaga?
--
-- Clique em /ir/[id] na mesma vaga, pelo mesmo usuário, DEPOIS da adaptação.
-- Não é candidatura — não temos como ver a candidatura —, é o proxy mais
-- próximo que o produto mede sozinho. Leitura só pela chave secreta.
-- ---------------------------------------------------------------------------
create or replace view public.adaptacoes_conversao
with (security_invoker = true) as
select
  a.id,
  a.user_id,
  a.job_id,
  a.criado_em,
  a.alertas,
  exists (
    select 1 from public.cliques c
    where c.user_id = a.user_id and c.job_id = a.job_id and c.criado_em >= a.criado_em
  ) as foi_para_a_vaga
from public.adaptacoes a
where a.ok;

revoke all on public.adaptacoes_conversao from anon, authenticated;
