-- 0011 — O clique sobrevive à vaga, e a vaga encerrada sai do feed (24/10/2026).
--
-- 1. `cliques.job_id` passa de `on delete cascade` para `on delete set null`.
--    Clique em "ver vaga" é a métrica que decide o Passo 5. Com cascade,
--    qualquer limpeza de `jobs` — até manual — apagava o histórico junto. Agora
--    a vaga pode ser apagada e o clique fica, sem a ligação.
--
-- 2. `jobs.encerrada_em`: vaga que a fonte deixou de listar. A janela de 7 dias
--    esconde vaga VELHA; isto esconde vaga FECHADA, que é a pior experiência do
--    produto — a pessoa clica e cai em "esta vaga não está mais disponível".
--    Marcada pela coleta diária (só Gupy, por enquanto); reaberta sozinha se a
--    vaga voltar a aparecer. É desativação, não exclusão: a linha fica para
--    dedup e métrica.

alter table public.cliques alter column job_id drop not null;

alter table public.cliques drop constraint if exists cliques_job_id_fkey;
alter table public.cliques
  add constraint cliques_job_id_fkey
  foreign key (job_id) references public.jobs (id) on delete set null;

alter table public.jobs add column if not exists encerrada_em timestamptz;

comment on column public.jobs.encerrada_em is
  'Quando a coleta viu que a fonte deixou de listar a vaga. Null = aberta (ou fonte sem verificação). O feed exige null.';

-- O feed filtra por isto em toda consulta; parcial porque quase tudo é null.
create index if not exists jobs_encerradas_idx on public.jobs (encerrada_em) where encerrada_em is not null;
