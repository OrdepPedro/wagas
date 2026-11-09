/**
 * A pessoa não pode apagar nem alterar as próprias adaptações: o teto diário
 * conta essas linhas, e apagar zerava o contador pelo PostgREST (0019).
 *
 * Lê as migrations em ordem e olha o estado FINAL das policies de
 * `adaptacoes`: uma migration futura que recrie `for all` quebra este teste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PASTA = join(import.meta.dirname, '..', 'migrations');

function policiesFinais(tabela: string): Map<string, string> {
  const policies = new Map<string, string>();
  for (const arquivo of readdirSync(PASTA).filter((a) => a.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(PASTA, arquivo), 'utf8').replace(/--.*$/gm, '');
    const comandos = sql.split(';');
    for (const c of comandos) {
      const drop = new RegExp(`drop policy if exists (\\w+) on public\\.${tabela}\\b`, 'i').exec(c);
      if (drop) policies.delete(drop[1]!);
      const cria = new RegExp(`create policy (\\w+)\\s+on public\\.${tabela}\\s+for (\\w+)`, 'i').exec(c);
      if (cria) policies.set(cria[1]!, cria[2]!.toLowerCase());
    }
  }
  return policies;
}

test('adaptacoes: a pessoa só lê e insere as próprias linhas', () => {
  const comandos = [...policiesFinais('adaptacoes').values()].sort();
  assert.deepEqual(comandos, ['insert', 'select']);
});

test('adaptacoes: update e delete revogados de anon e authenticated', () => {
  const ultima = readdirSync(PASTA)
    .filter((a) => a.endsWith('.sql'))
    .sort()
    .map((a) => readFileSync(join(PASTA, a), 'utf8'))
    .join('\n');
  assert.match(ultima, /revoke update, delete on public\.adaptacoes from anon, authenticated/);
});
