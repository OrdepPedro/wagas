/**
 * A pessoa não pode apagar nem alterar as próprias adaptações: o teto diário
 * conta essas linhas, e apagar zerava o contador pelo PostgREST (0019).
 * "Apagar meu currículo" zera `resultado` pela chave de servidor, que ignora
 * RLS — então nem `resultado` a pessoa altera (0020).
 *
 * Lê as migrations em ordem e olha o estado FINAL das policies e dos
 * privilégios de `adaptacoes`: uma migration futura que recrie `for all`, ou
 * devolva update a `authenticated`, quebra este teste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PASTA = join(import.meta.dirname, '..', 'migrations');

/** Comandos SQL, sem comentário e com espaço normalizado. */
function separar(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Todas as migrations, em ordem de aplicação. */
function migrations(): string[] {
  return readdirSync(PASTA)
    .filter((a) => a.endsWith('.sql'))
    .sort()
    .flatMap((a) => separar(readFileSync(join(PASTA, a), 'utf8')));
}

function policiesFinais(comandos: string[], tabela: string): Map<string, string> {
  const drop = new RegExp(String.raw`^drop policy if exists (\w+) on public\.${tabela}$`, 'i');
  const cria = new RegExp(String.raw`^create policy (\w+) on public\.${tabela} for (\w+)\b`, 'i');
  const policies = new Map<string, string>();
  for (const c of comandos) {
    const d = drop.exec(c);
    if (d) policies.delete(d[1]!);
    const m = cria.exec(c);
    if (m) policies.set(m[1]!, m[2]!.toLowerCase());
  }
  return policies;
}

/**
 * Se `papel` termina com o privilégio, seguindo grant/revoke em ordem — por
 * tabela ou por coluna (`grant update (resultado)` conta como update).
 */
function temPrivilegio(comandos: string[], tabela: string, privilegio: string, papel: string): boolean {
  const alvo = new RegExp(
    String.raw`^(grant|revoke) ([\w\s,()]*?\b${privilegio}\b[\w\s,()]*?) on (?:table )?public\.${tabela} (?:to|from) ([\w\s,]+)$`,
    'i',
  );
  let tem = false;
  for (const c of comandos) {
    const m = alvo.exec(c);
    if (!m) continue;
    const papeis = m[3]!.split(',').map((p) => p.trim().toLowerCase());
    if (!papeis.includes(papel) && !papeis.includes('public')) continue;
    tem = m[1]!.toLowerCase() === 'grant';
  }
  return tem;
}

test('adaptacoes: a pessoa só lê e insere as próprias linhas', () => {
  const finais = [...policiesFinais(migrations(), 'adaptacoes').values()].sort();
  assert.deepEqual(finais, ['insert', 'select']);
});

test('adaptacoes: anon e authenticated terminam sem update, delete nem truncate', () => {
  const comandos = migrations();
  for (const papel of ['anon', 'authenticated']) {
    for (const privilegio of ['update', 'delete', 'truncate']) {
      assert.equal(
        temPrivilegio(comandos, 'adaptacoes', privilegio, papel),
        false,
        `${papel} termina com ${privilegio}`,
      );
    }
  }
});

test('adaptacoes: os leitores enxergam o que as duas 0019 deixaram sem a 0020', () => {
  // Sem estes casos, um leitor quebrado faz os testes acima passarem por não
  // ver nada. É o estado do main antes da 0020.
  const sql = separar(`
    create policy adaptacoes_dono_le on public.adaptacoes for select using (true);
    create policy adaptacoes_leitura on public.adaptacoes for select to authenticated using (true);
    create policy adaptacoes_apagar_conteudo on public.adaptacoes for update to authenticated using (true);
    revoke update, delete, truncate on public.adaptacoes from anon, authenticated;
    grant update (resultado) on public.adaptacoes to authenticated;
  `);
  assert.deepEqual([...policiesFinais(sql, 'adaptacoes').values()].sort(), ['select', 'select', 'update']);
  assert.equal(temPrivilegio(sql, 'adaptacoes', 'update', 'authenticated'), true);
  assert.equal(temPrivilegio(sql, 'adaptacoes', 'delete', 'authenticated'), false);
  assert.equal(temPrivilegio(sql, 'adaptacoes', 'update', 'anon'), false);
});
