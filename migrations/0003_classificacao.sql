-- 0003 — contabilidade da classificação (Passo 3)
--
-- Até aqui `raw_results` só sabia dizer se um resultado já tinha sido visto
-- pelo classificador (`processado`). Isso não basta: quando o feed vier vazio
-- para um segmento, a pergunta vai ser QUAL regra derrubou o quê. Sem o motivo
-- gravado, a única resposta possível seria "entraram 300, sobraram 40" — que
-- não distingue problema de produto de problema de infraestrutura.
--
-- Com o motivo na linha, o harness roda sobre dado de produção e mede cada
-- regra separadamente, do mesmo jeito que roda sobre o golden set.

alter table public.raw_results
  add column if not exists classificacao        text,
  add column if not exists classificacao_motivo text,
  add column if not exists classificacao_estagio text,
  add column if not exists classificado_em      timestamptz,
  add column if not exists classificador        text;

do $$
begin
  alter table public.raw_results
    add constraint raw_results_classificacao_valida
    check (classificacao is null or classificacao in ('aprovado', 'rejeitado', 'erro'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.raw_results
    add constraint raw_results_estagio_valido
    check (classificacao_estagio is null or classificacao_estagio in ('prefiltro', 'llm'));
exception
  when duplicate_object then null;
end
$$;

comment on column public.raw_results.classificacao_motivo is
  'Por que caiu: pagina_de_listagem, fora_da_janela, cargo_fora_do_titulo, nao_e_vaga, cargo_de_outra_familia, confianca_baixa, erro_do_classificador.';
comment on column public.raw_results.classificacao_estagio is
  'prefiltro = decidido de graça; llm = custou token. Separa as duas contas de custo.';

-- `erro_do_classificador` é falha de infraestrutura (cota, rede, resposta
-- inválida), não veredito sobre a vaga: essas linhas continuam com
-- processado = false e voltam na próxima rodada. Este índice é o que a rodada
-- usa para achá-las sem varrer a tabela inteira.
create index if not exists raw_results_erro_idx
  on public.raw_results (classificado_em desc)
  where classificacao = 'erro';

-- ---------------------------------------------------------------------------
-- jobs: o classificador é o único que escreve aqui.
--
-- `cargo_normalizado` já existia como coluna solta. A unicidade real é
-- `dedup_key` (empresa + cargo normalizado), que a migration 0001 já criou.
-- O que faltava era saber de onde veio a chave quando NÃO houve empresa: nesse
-- caso a chave cai para o id nativo da fonte, e a coluna abaixo registra isso
-- para o harness não confundir "não deduplicou" com "não havia duplicata".
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists dedup_por_empresa boolean not null default true;

comment on column public.jobs.dedup_por_empresa is
  'false quando o classificador não identificou a empresa e a chave caiu para o id da fonte.';
