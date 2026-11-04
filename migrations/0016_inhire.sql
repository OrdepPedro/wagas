-- 0016 — InHire como fonte, pelo bloco `ats_inhire` da SERP.
--
-- Só abre o `check` de `fonte` nas duas tabelas, como a 0008 fez para o InfoJobs.

alter table public.raw_results drop constraint if exists raw_results_fonte_check;
alter table public.raw_results
  add constraint raw_results_fonte_check
  check (fonte in ('linkedin_job', 'linkedin_post', 'ats_gupy', 'ats_inhire', 'portal_infojobs', 'desconhecida'));

alter table public.jobs drop constraint if exists jobs_fonte_check;
alter table public.jobs
  add constraint jobs_fonte_check
  check (fonte in ('linkedin_job', 'linkedin_post', 'ats_gupy', 'ats_inhire', 'portal_infojobs'));
