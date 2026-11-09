-- 0019 — Correções da varredura de segurança de 09/11/2026.
--
-- Três falhas, todas de permissão no banco. Nenhuma muda o que o site faz:
-- o servidor do site usa exatamente as operações que continuam liberadas, e os
-- scripts de coleta usam a chave secreta, que não passa por nada disto.
--
-- Idempotente: pode rodar duas vezes.

-- ---------------------------------------------------------------------------
-- 1. `demanda_descoberta` estava legível por qualquer pessoa, sem login.
--
-- View sem `security_invoker` roda com a permissão do dono e IGNORA a RLS de
-- `buscas`; e o Supabase dá `select` em tudo do schema `public` para `anon` e
-- `authenticated` por padrão. Confirmado em produção em 09/11: um GET com a
-- chave pública devolvia os termos digitados, a cidade e as datas.
--
-- As duas trancas, como a `adaptacoes_conversao` já tinha: a view passa a
-- respeitar a RLS de quem consulta, e a chave pública perde o acesso. Quem lê
-- é `scripts/coletar-demanda.ts`, com a chave secreta.
-- ---------------------------------------------------------------------------
alter view public.demanda_descoberta set (security_invoker = true);
revoke all on public.demanda_descoberta from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Os tetos de uso eram contados em tabelas que o próprio usuário podia
--    apagar.
--
-- As policies eram `for all`: com o token da sessão, direto no PostgREST, a
-- pessoa apagava as próprias linhas de `buscas` (teto de buscas por dia) e de
-- `adaptacoes` (teto de 5 adaptações por dia, numa cota de IA que serve ~1
-- adaptação por minuto ao produto inteiro), e alterava `cliques`, que é a
-- métrica que decide o produto.
--
-- O site só LÊ e INSERE nessas tabelas. Passa a ser só isso.
--
-- Inserir continua liberado, porque é a sessão da pessoa que grava a busca, o
-- clique e a adaptação. Linha forjada em `buscas` ou `adaptacoes` só gasta o
-- teto de quem forjou; em `cliques`, infla a métrica — fechar isso exige mover
-- a gravação para a chave secreta, que é mudança de código, não de policy.
-- ---------------------------------------------------------------------------

-- buscas
drop policy if exists buscas_dono on public.buscas;
drop policy if exists buscas_leitura on public.buscas;
drop policy if exists buscas_insercao on public.buscas;

create policy buscas_leitura
  on public.buscas for select
  to authenticated
  using (user_id = auth.uid());

create policy buscas_insercao
  on public.buscas for insert
  to authenticated
  with check (user_id = auth.uid());

revoke update, delete, truncate on public.buscas from anon, authenticated;

-- cliques
drop policy if exists cliques_dono on public.cliques;
drop policy if exists cliques_leitura on public.cliques;
drop policy if exists cliques_insercao on public.cliques;

create policy cliques_leitura
  on public.cliques for select
  to authenticated
  using (user_id = auth.uid());

create policy cliques_insercao
  on public.cliques for insert
  to authenticated
  with check (user_id = auth.uid());

revoke update, delete, truncate on public.cliques from anon, authenticated;

-- adaptacoes
--
-- Aqui existe UM update legítimo: "apagar meu currículo" zera o `resultado`
-- das adaptações (`apagarCurriculo`, web/lib/adaptacao.ts) e deixa a linha,
-- que é a contagem. Então o update fica, estreito dos dois lados: só a coluna
-- `resultado` (grant por coluna) e só para null (with check). Não dá para
-- mexer em `ok` nem em `criado_em`, que são o que o teto conta.
drop policy if exists adaptacoes_dono on public.adaptacoes;
drop policy if exists adaptacoes_leitura on public.adaptacoes;
drop policy if exists adaptacoes_insercao on public.adaptacoes;
drop policy if exists adaptacoes_apagar_conteudo on public.adaptacoes;

create policy adaptacoes_leitura
  on public.adaptacoes for select
  to authenticated
  using (user_id = auth.uid());

create policy adaptacoes_insercao
  on public.adaptacoes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy adaptacoes_apagar_conteudo
  on public.adaptacoes for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and resultado is null);

revoke update, delete, truncate on public.adaptacoes from anon, authenticated;
grant update (resultado) on public.adaptacoes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. `cargos_sugeridos` entregava `sugerido_por` (o id do usuário que sugeriu)
--    a visitante sem login.
--
-- A lista pública só precisa do cargo. O `select` passa a ser por coluna, sem
-- `sugerido_por`. O insert não muda: o site grava sem pedir a linha de volta.
-- ---------------------------------------------------------------------------
revoke select on public.cargos_sugeridos from anon, authenticated;
grant select (id, cargo, familia, criado_em, coletado_em, vagas_ultima_coleta)
  on public.cargos_sugeridos to anon, authenticated;
