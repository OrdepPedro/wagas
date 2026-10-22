-- 0009 — Tipo de contrato no cartão, e a origem de data "pagina_html" (22/10/2026).
--
-- As vagas remotas do InfoJobs ("em Todo Brasil") não trazem JSON-LD
-- `JobPosting`. A data delas sai do bloco da vaga no HTML — "Hoje", "Ontem",
-- "20 out" —, que é sinal diferente de metatag: só tem precisão de dia. A origem
-- separada deixa isso visível em vez de misturado com dado estruturado.
--
-- `tipo_contrato` é texto da fonte ("Efetivo – CLT", "Prestador de Serviços
-- (PJ)"), não enum: o cartão mostra o que o anunciante declarou, para a pessoa
-- ver "PJ" antes de clicar em vez de o parser decidir o que é vaga de verdade.

alter table public.jobs add column if not exists tipo_contrato text;

comment on column public.jobs.tipo_contrato is
  'Tipo de contrato como a fonte declara (ex.: "Efetivo – CLT - Período Integral"). Null quando a fonte não informa.';

alter table public.raw_results drop constraint if exists raw_results_data_publicacao_origem_check;
alter table public.raw_results
  add constraint raw_results_data_publicacao_origem_check
  check (data_publicacao_origem in ('gupy_snippet', 'gupy_api', 'metatag', 'pagina_html', 'desconhecida'));

alter table public.jobs drop constraint if exists jobs_origem_data_valida;
alter table public.jobs
  add constraint jobs_origem_data_valida
  check (data_publicacao_origem in ('gupy_snippet', 'gupy_api', 'metatag', 'pagina_html', 'desconhecida'));
