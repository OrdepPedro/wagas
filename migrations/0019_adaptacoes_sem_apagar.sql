-- 0019 — A pessoa não apaga nem altera as próprias adaptações (09/11/2026).
--
-- O teto diário de adaptações conta as linhas de `adaptacoes` com `ok` de hoje.
-- A policy `adaptacoes_dono` da 0015 era `for all`: com a chave pública (que
-- está no site) e o próprio token, qualquer pessoa logada chamava o PostgREST
-- direto, apagava as próprias linhas ou punha `ok = false`, e o contador
-- voltava a zero. O dano não é vazamento — a RLS segura o dado dos outros —,
-- é esgotar a cota gratuita do Groq, que serve o produto inteiro (~1
-- adaptação/minuto).
--
-- Fica: ler as próprias linhas (tela e PDF) e inserir as próprias (o servidor
-- grava a tentativa com o cliente da pessoa). Sai: update e delete. O
-- "apagar meu currículo" zera `resultado` pela chave de servidor
-- (`web/lib/adaptacao.ts`), que ignora RLS.

drop policy if exists adaptacoes_dono on public.adaptacoes;
drop policy if exists adaptacoes_dono_le on public.adaptacoes;
drop policy if exists adaptacoes_dono_grava on public.adaptacoes;

create policy adaptacoes_dono_le
  on public.adaptacoes for select
  using (user_id = auth.uid());

create policy adaptacoes_dono_grava
  on public.adaptacoes for insert
  with check (user_id = auth.uid());

-- Sem policy de update/delete, a RLS já recusa. O revoke é a segunda tranca:
-- se alguém recriar uma policy `for all` por engano, o privilégio continua fora.
revoke update, delete on public.adaptacoes from anon, authenticated;
