-- 0018 — Adaptação para vaga colada (extensão do Chrome, 06/11/2026).
--
-- Até aqui toda adaptação era de uma vaga do feed (`job_id`). A extensão deixa
-- a pessoa colar cargo e descrição de qualquer vaga; o CV continua o salvo.
-- A extensão NÃO lê a página (restrição 2 e decisão do Pedro).
--
-- `origem` é a métrica que esta feature cria: adaptação de vaga do feed contra
-- vaga de fora. Se a de fora dominar, o encaixe vaga + CV — o diferencial do
-- CLAUDE.md — não está segurando o uso.
--
-- O texto da vaga colada NÃO é gravado: só cargo, empresa e o hash, que basta
-- para não gastar cota de novo quando a mesma vaga é colada duas vezes.

alter table public.adaptacoes
  add column if not exists origem text not null default 'feed',
  add column if not exists vaga_cargo text,
  add column if not exists vaga_empresa text,
  add column if not exists vaga_hash text;

alter table public.adaptacoes drop constraint if exists adaptacoes_origem_check;
alter table public.adaptacoes
  add constraint adaptacoes_origem_check check (origem in ('feed', 'colada'));

create index if not exists adaptacoes_colada_idx
  on public.adaptacoes (user_id, vaga_hash, curriculo_hash) where ok and origem = 'colada';

-- A conversão (CV gerado → clique em /ir na mesma vaga) só existe para vaga
-- do feed: a colada não tem `job_id` e daria sempre "não foi", puxando a taxa
-- para baixo sem motivo.
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
where a.ok and a.origem = 'feed';

revoke all on public.adaptacoes_conversao from anon, authenticated;
