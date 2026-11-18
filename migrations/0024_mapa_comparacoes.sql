-- 0024 — Comparação do currículo com a vaga, no Mapa (17/11/2026).
-- Duas tabelas: `mapa_comparacoes` (uma por tentativa, por pessoa) e
-- `vaga_requisitos` (a lista de requisitos de cada vaga, compartilhada; no fim).
--
-- Uma linha por tentativa, com sucesso ou não, no molde de `adaptacoes`
-- (0015, 0019, 0020): a falha também é gravada porque taxa de falha do
-- provedor é o primeiro número a olhar, e só as que deram certo contam para o
-- teto diário (2 por dia no teste do Mapa).
--
-- A pessoa lê e insere as próprias linhas, e só. Sem update nem delete: o teto
-- conta `ok` e `criado_em`, e apagar a própria linha zeraria o contador.
--
-- `resultado` guarda os requisitos e o TRECHO do CV que prova cada um — é dado
-- de currículo. "Apagar meu currículo" o zera pela chave de servidor
-- (`apagarCurriculo` em web/lib/adaptacao.ts), como faz com as adaptações.
--
-- `curriculo_hash`: trocou o CV, a comparação antiga não vale mais.
-- `rebaixados`: quantos status o código derrubou por citação que não está no
-- CV. É a taxa de invenção do modelo, medida em vez de escondida.

create table if not exists public.mapa_comparacoes (
  id             bigint      generated always as identity primary key,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  job_id         bigint      references public.jobs (id) on delete set null,
  curriculo_hash text        not null,
  provedor       text        not null,
  ok             boolean     not null,
  resultado      jsonb,
  rebaixados     integer,
  erro           text,
  duracao_ms     integer,
  criado_em      timestamptz not null default now()
);

create index if not exists mapa_comparacoes_usuario
  on public.mapa_comparacoes (user_id, criado_em desc);

alter table public.mapa_comparacoes enable row level security;

drop policy if exists mapa_comparacoes_le on public.mapa_comparacoes;
create policy mapa_comparacoes_le
  on public.mapa_comparacoes for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists mapa_comparacoes_grava on public.mapa_comparacoes;
create policy mapa_comparacoes_grava
  on public.mapa_comparacoes for insert
  to authenticated
  with check (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

revoke update, delete, truncate on public.mapa_comparacoes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- vaga_requisitos: a lista de requisitos de cada vaga, extraída UMA vez.
--
-- Medido em 17/11: extraindo a lista junto com a comparação, ela mudou entre
-- duas rodadas em 4 de 6 vagas, e o placar "X de Y" virou sorteio. Congelada
-- aqui, a mesma vaga mostra o mesmo denominador para todo mundo.
--
-- Não é dado pessoal (vem só da descrição pública da vaga) e é compartilhada
-- entre usuários. Por isso só a chave de servidor grava: com insert aberto,
-- qualquer pessoa logada poderia envenenar a lista que os outros veem.
-- `provedor` diz qual modelo extraiu, para reextrair se um deles se mostrar
-- ruim.
-- ---------------------------------------------------------------------------
create table if not exists public.vaga_requisitos (
  job_id     bigint      primary key references public.jobs (id) on delete cascade,
  requisitos jsonb       not null,
  provedor   text        not null,
  criado_em  timestamptz not null default now()
);

alter table public.vaga_requisitos enable row level security;

drop policy if exists vaga_requisitos_leitura on public.vaga_requisitos;
create policy vaga_requisitos_leitura
  on public.vaga_requisitos for select
  to authenticated
  using (true);

revoke insert, update, delete, truncate on public.vaga_requisitos from anon, authenticated;
