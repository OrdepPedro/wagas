-- 0008 — InfoJobs como fonte (achado 37, restrição 3 ampliada em 20/10/2026).
--
-- Só abre o `check` de `fonte` nas duas tabelas. A data vem do JSON-LD
-- `JobPosting` da página da vaga, que é o que `data_publicacao_origem =
-- 'metatag'` já descrevia desde a 0001 — não precisa de valor novo.
--
-- Os checks da 0001 foram declarados inline, sem nome, então o Postgres os
-- batizou `<tabela>_fonte_check`.

alter table public.raw_results drop constraint if exists raw_results_fonte_check;
alter table public.raw_results
  add constraint raw_results_fonte_check
  check (fonte in ('linkedin_job', 'linkedin_post', 'ats_gupy', 'portal_infojobs', 'desconhecida'));

alter table public.jobs drop constraint if exists jobs_fonte_check;
alter table public.jobs
  add constraint jobs_fonte_check
  check (fonte in ('linkedin_job', 'linkedin_post', 'ats_gupy', 'portal_infojobs'));
