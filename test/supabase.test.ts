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

const semEspera = async () => {};

const RELOGIO = '{"code":"PGRST303","message":"JWT issued at future"}';

test('"JWT issued at future" é relógio, não chave: espera e repete', async () => {
  const r = respostas([401, RELOGIO], [200, '[{"id":1}]']);
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r.fetch, semEspera);
  assert.deepEqual(await db.select('jobs', 'select=id'), [{ id: 1 }]);
  assert.equal(r.chamadas(), 2);
});

test('outro 401 é chave errada e falha na hora, sem repetir', async () => {
  const r = respostas([401, '{"code":"PGRST301","message":"invalid JWT"}']);
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r.fetch, semEspera);
  await assert.rejects(db.select('jobs', 'select=id'), /401/);
  assert.equal(r.chamadas(), 1);
});

// 522 é o Cloudflare na frente do Supabase dizendo que o banco não respondeu a
// tempo. Derrubou a coleta diária de 21/11 e de 24/11, com o banco de pé depois.
const TIMEOUT_CF = '<!DOCTYPE html><span class="code-label">Error code 522</span>';

test('522 em leitura é passageiro: espera e repete', async () => {
  const r = respostas([522, TIMEOUT_CF], [503, ''], [200, '[{"id":1}]']);
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r.fetch, semEspera);
  assert.deepEqual(await db.select('jobs', 'select=id'), [{ id: 1 }]);
  assert.equal(r.chamadas(), 3);
});

test('insert com on_conflict repete o 522: repetir não duplica linha', async () => {
  const r = respostas([522, TIMEOUT_CF], [201, '']);
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r.fetch, semEspera);
  await db.insert('raw_results', [{ url_hash: 'a' }], { ignorarDuplicados: true, conflito: 'url_hash' });
  assert.equal(r.chamadas(), 2);
});

test('insert simples e rpc NÃO repetem 5xx: o banco pode ter gravado', async () => {
  const r1 = respostas([522, TIMEOUT_CF], [201, '']);
  const db1 = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r1.fetch, semEspera);
  await assert.rejects(db1.insert('buscas', [{ a: 1 }]), /522/);
  assert.equal(r1.chamadas(), 1);

  const r2 = respostas([522, TIMEOUT_CF], [200, 'true']);
  const db2 = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r2.fetch, semEspera);
  await assert.rejects(db2.rpc('reservar_saldo', { n: 1 }), /522/);
  assert.equal(r2.chamadas(), 1);
});

test('522 persistente desiste depois de três repetições', async () => {
  const esperas: number[] = [];
  const r = respostas([522, TIMEOUT_CF]);
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r.fetch, async (ms) => { esperas.push(ms); });
  await assert.rejects(db.select('jobs', 'select=id'), /522/);
  assert.equal(r.chamadas(), 4);
  assert.deepEqual(esperas, [5_000, 15_000, 30_000]);
});

test('falha de rede em leitura é repetida', async () => {
  let i = 0;
  const f = (async () => {
    if (i++ === 0) throw new TypeError('fetch failed');
    return new Response('[]', { status: 200 });
  }) as unknown as typeof fetch;
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', f, semEspera);
  assert.deepEqual(await db.select('jobs', 'select=id'), []);
  assert.equal(i, 2);
});

test('400 é pedido errado e falha na hora, sem repetir', async () => {
  const r = respostas([400, '{"code":"PGRST102","message":"All object keys must match"}']);
  const db = new SupabaseRest('https://x.supabase.co', 'sb_secret_x', r.fetch, semEspera);
  await assert.rejects(db.insert('jobs', [{ a: 1 }], { ignorarDuplicados: true, conflito: 'dedup_key' }), /400/);
  assert.equal(r.chamadas(), 1);
});
