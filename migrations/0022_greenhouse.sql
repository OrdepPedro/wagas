-- 0022 — Greenhouse como fonte (achado 36), pelo quadro público de cada empresa.
--
-- Abre o `check` de `fonte` nas duas tabelas, como a 0016 fez para o InHire, e
-- a origem de data `greenhouse_api`: o `first_published` da API é data de
-- publicação com hora, e gravá-lo como `metatag` mentiria sobre a procedência.
--
-- Uma vaga anunciada em várias cidades vira uma linha de `jobs` por cidade, todas
-- apontando para a mesma linha de `raw_results`. Nada no schema impede: só
-- `dedup_key` é única, e ela leva a cidade (`ats_greenhouse:<id>@<cidade>`).

alter table public.raw_results drop constraint if exists raw_results_fonte_check;
alter table public.raw_results
  add constraint raw_results_fonte_check
  check (fonte in ('linkedin_job', 'linkedin_post', 'ats_gupy', 'ats_inhire', 'ats_greenhouse', 'portal_infojobs', 'desconhecida'));

alter table public.jobs drop constraint if exists jobs_fonte_check;
alter table public.jobs
  add constraint jobs_fonte_check
  check (fonte in ('linkedin_job', 'linkedin_post', 'ats_gupy', 'ats_inhire', 'ats_greenhouse', 'portal_infojobs'));

alter table public.raw_results drop constraint if exists raw_results_data_publicacao_origem_check;
alter table public.raw_results
  add constraint raw_results_data_publicacao_origem_check
  check (data_publicacao_origem in ('gupy_snippet', 'gupy_api', 'greenhouse_api', 'metatag', 'pagina_html', 'desconhecida'));

alter table public.jobs drop constraint if exists jobs_origem_data_valida;
alter table public.jobs
  add constraint jobs_origem_data_valida
  check (data_publicacao_origem in ('gupy_snippet', 'gupy_api', 'greenhouse_api', 'metatag', 'pagina_html', 'desconhecida'));
