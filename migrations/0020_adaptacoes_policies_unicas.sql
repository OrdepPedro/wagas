-- 0020 — Uma policy por operação em `adaptacoes`, e nenhum update (10/11/2026).
--
-- Duas migrations 0019 entraram no main no mesmo dia, de PRs paralelos, e as
-- duas reescreveram as policies de `adaptacoes` com nomes diferentes:
--
--   0019_adaptacoes_sem_apagar  adaptacoes_dono_le (select)
--                               adaptacoes_dono_grava (insert)
--                               revoke update, delete
--   0019_seguranca_rls          adaptacoes_leitura (select)
--                               adaptacoes_insercao (insert)
--                               adaptacoes_apagar_conteudo (update)
--                               grant update (resultado)
--
-- Aplicadas em ordem, sobram duas de select, duas de insert e uma de update.
-- As duplicadas são inócuas (mesma condição), mas o update não precisa existir:
-- a seguranca_rls o criou para o "apagar meu currículo" zerar `resultado` com o
-- cliente da pessoa, e desde a ac3956e `apagarCurriculo` (web/lib/adaptacao.ts)
-- faz isso pela chave de servidor, que ignora RLS. Nenhum outro caminho do site
-- altera `adaptacoes` com o token da pessoa.
--
-- Estado final: a pessoa lê e insere as próprias linhas, e só. Não apaga, não
-- altera `ok` nem `criado_em` (o que o teto diário conta) e não altera
-- `resultado`.
--
-- Idempotente: serve tanto para o banco que recebeu as duas 0019 quanto para o
-- que recebeu só uma.

drop policy if exists adaptacoes_dono on public.adaptacoes;
drop policy if exists adaptacoes_dono_le on public.adaptacoes;
drop policy if exists adaptacoes_dono_grava on public.adaptacoes;
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

-- O revoke por coluna desfaz o `grant update (resultado)` da seguranca_rls; o
-- de tabela é a segunda tranca, caso alguém recrie uma policy `for all`.
revoke update (resultado) on public.adaptacoes from anon, authenticated;
revoke update, delete, truncate on public.adaptacoes from anon, authenticated;
