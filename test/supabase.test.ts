import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRest } from '../src/db/supabase.ts';

function respostas(...lista: Array<[number, string]>): { fetch: typeof fetch; chamadas: () => number } {
  let i = 0;
  const f = (async () => {
    const [status, corpo] = lista[Math.min(i++, lista.length - 1)]!;
    return new Response(corpo, { status });
  }) as unknown as typeof fetch;
  return { fetch: f, chamadas: () => i };
}

const RELOGIO = '{"code":"PGRST303","message":"JWT issued at future"}';

test('"JWT issued at future" é relógio, não chave: espera e repete', async () => {
  const r = respostas([401, RELOGIO], [200, '[{"id":1}]']);
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r.fetch);
  assert.deepEqual(await db.select('jobs', 'select=id'), [{ id: 1 }]);
  assert.equal(r.chamadas(), 2);
});

test('outro 401 é chave errada e falha na hora, sem repetir', async () => {
  const r = respostas([401, '{"code":"PGRST301","message":"invalid JWT"}']);
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r.fetch);
  await assert.rejects(db.select('jobs', 'select=id'), /401/);
  assert.equal(r.chamadas(), 1);
});
