-- 0022 — Revisão do currículo adaptado antes do PDF (16/11/2026).
--
-- Pedido do Pedro: a adaptação não gera o PDF de cara. A pessoa lê, pode pedir
-- ajustes à IA num chat e, quando estiver bom, confirma — só então baixa.
--
-- Duas peças:
--
--   * `adaptacao_correcoes`: uma linha por pedido no chat, com sucesso ou não
--     (mesmo desenho de `adaptacoes`). `resultado` é o CV inteiro depois do
--     ajuste; null quando a IA não mudou nada (recusou inventar, por exemplo).
--     A versão atual de uma adaptação é a última correção com `resultado`, ou
--     a própria adaptação se não houver nenhuma. O `pedido` é o dado mais
--     valioso daqui: é o que as pessoas acham errado no que a IA entregou.
--
--   * `adaptacoes.confirmada_versao` + `confirmado_em`: qual versão a pessoa
--     confirmou (0 = a adaptação original; senão, o id da correção). O PDF só
--     sai da versão confirmada, e um ajuste depois da confirmação a desfaz por
--     construção — a versão atual deixa de ser a confirmada. Id e não
--     timestamp: comparar relógio do Vercel com o do Postgres seria apostar.
--
-- A confirmação é gravada pela chave de servidor: desde a 0019/0020 a pessoa
-- não altera `adaptacoes` (o teto diário conta essas linhas).
--
-- "Apagar meu currículo" zera `pedido`, `resposta` e `resultado` das correções
-- também (web/lib/adaptacao.ts): pedido no chat pode conter dado do CV.

alter table public.adaptacoes
  add column if not exists confirmado_em timestamptz,
  add column if not exists confirmada_versao bigint;

create table if not exists public.adaptacao_correcoes (
  id            bigint      generated always as identity primary key,
  adaptacao_id  bigint      not null references public.adaptacoes (id) on delete cascade,
  user_id       uuid        references auth.users (id) on delete set null,
  pedido        text        check (length(pedido) <= 1000),
  resposta      text,
  resultado     jsonb,
  ok            boolean     not null,
  -- `verificarFidelidade` sobre a versão nova, já contando o que a pessoa
  -- afirmou no chat como fonte.
  alertas       integer,
  provedor      text,
  duracao_ms    integer,
  erro          text,
  criado_em     timestamptz not null default now()
);

create index if not exists adaptacao_correcoes_adaptacao_idx
  on public.adaptacao_correcoes (adaptacao_id, id);
create index if not exists adaptacao_correcoes_usuario_idx
  on public.adaptacao_correcoes (user_id, criado_em desc);

alter table public.adaptacao_correcoes enable row level security;

drop policy if exists adaptacao_correcoes_leitura on public.adaptacao_correcoes;
drop policy if exists adaptacao_correcoes_insercao on public.adaptacao_correcoes;

create policy adaptacao_correcoes_leitura
  on public.adaptacao_correcoes for select
  to authenticated
  using (user_id = auth.uid());

-- Só insere correção de adaptação própria. Sem o `exists`, daria para pendurar
-- linha na adaptação de outra pessoa (sem ler nada dela, mas sujando a conversa).
create policy adaptacao_correcoes_insercao
  on public.adaptacao_correcoes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.adaptacoes a where a.id = adaptacao_id and a.user_id = auth.uid())
  );

-- Mesma tranca de `adaptacoes`: o teto diário de ajustes conta estas linhas.
revoke update, delete, truncate on public.adaptacao_correcoes from anon, authenticated;
