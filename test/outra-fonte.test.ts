import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRest } from '../src/db/supabase.ts';
import {
  avisoDoPedido,
  dispararColeta,
  pedirOutraFonte,
  type Pedido,
} from '../src/coleta/outra-fonte.ts';

const AGORA = new Date('2026-10-30T15:00:00Z');
const minutosAtras = (n: number) => new Date(AGORA.getTime() - n * 60_000).toISOString();

function pedido(extra: Partial<Pedido> = {}): Pedido {
  return {
    cargo_chave: 'fisioterapeuta',
    cidade_slug: 'recife',
    cargo: 'Fisioterapeuta',
    cidade: 'Recife',
    status: 'pendente',
    pedido_em: minutosAtras(1),
    concluido_em: null,
    vagas_gravadas: null,
    ...extra,
  };
}

test('aviso: em andamento consulta, e vira "mais tarde" quando o pedido expira', () => {
  assert.equal(avisoDoPedido(pedido(), AGORA)?.tipo, 'consultando');
  assert.equal(avisoDoPedido(pedido({ status: 'rodando' }), AGORA)?.tipo, 'consultando');
  assert.equal(avisoDoPedido(pedido({ pedido_em: minutosAtras(25) }), AGORA)?.tipo, 'mais_tarde');
});

test('aviso: pronto diz quantas vagas, ou que não veio nada novo', () => {
  assert.deepEqual(avisoDoPedido(pedido({ status: 'pronto', vagas_gravadas: 12 }), AGORA), {
    pedidoEm: minutosAtras(1),
    tipo: 'chegou',
    vagas: 12,
  });
  assert.equal(avisoDoPedido(pedido({ status: 'pronto', vagas_gravadas: 0 }), AGORA)?.tipo, 'nada_novo');
});

test('aviso: falha e adiamento viram "mais tarde"; sem UF e pedido velho não dizem nada', () => {
  assert.equal(avisoDoPedido(pedido({ status: 'falhou' }), AGORA)?.tipo, 'mais_tarde');
  assert.equal(avisoDoPedido(pedido({ status: 'adiado' }), AGORA)?.tipo, 'mais_tarde');
  assert.equal(avisoDoPedido(pedido({ status: 'sem_uf' }), AGORA), null);
  assert.equal(avisoDoPedido(pedido({ status: 'pronto', vagas_gravadas: 3, pedido_em: minutosAtras(180) }), AGORA), null);
  assert.equal(avisoDoPedido(null, AGORA), null);
});

function banco(opts: { pedido?: Pedido | null; ultimaInfojobs?: string | null }) {
  const inserts: unknown[] = [];
  const fetchFalso = (async (url: string | URL, init?: RequestInit) => {
    const caminho = String(url);
    const metodo = init?.method ?? 'GET';
    if (metodo === 'GET' && caminho.includes('pedidos_outra_fonte')) {
      return new Response(JSON.stringify(opts.pedido ? [opts.pedido] : []), { status: 200 });
    }
    if (metodo === 'GET' && caminho.includes('coletas_sob_demanda')) {
      assert.match(caminho, /fonte=eq\.infojobs/);
      const linhas = opts.ultimaInfojobs ? [{ ultima_coleta: opts.ultimaInfojobs }] : [];
      return new Response(JSON.stringify(linhas), { status: 200 });
    }
    if (metodo === 'POST' && caminho.includes('pedidos_outra_fonte')) {
      const corpo = JSON.parse(String(init?.body)) as unknown[];
      inserts.push(...corpo);
      return new Response(JSON.stringify(corpo), { status: 201 });
    }
    throw new Error(`chamada inesperada: ${metodo} ${caminho}`);
  }) as typeof fetch;
  return { db: new SupabaseRest('https://x.supabase.co', 'chave', fetchFalso), inserts };
}

test('pedido: par novo vira pendente e pede disparo', async () => {
  const { db, inserts } = banco({});
  const r = await pedirOutraFonte(db, { cargo: ' Fisioterapeuta ', cidade: 'Recife' }, AGORA);
  assert.equal(r.novo, true);
  assert.equal(inserts.length, 1);
  assert.deepEqual(
    { ...(inserts[0] as object) },
    {
      cargo_chave: 'fisioterapeuta',
      cidade_slug: 'recife',
      cargo: 'Fisioterapeuta',
      cidade: 'Recife',
      status: 'pendente',
      pedido_em: AGORA.toISOString(),
      iniciado_em: null,
      concluido_em: null,
      vagas_gravadas: null,
      motivo: null,
    },
  );
});

// Dez pessoas buscando o mesmo par geram uma coleta, não dez.
test('pedido: com outro em andamento, reaproveita e não dispara', async () => {
  const { db, inserts } = banco({ pedido: pedido({ status: 'rodando' }) });
  const r = await pedirOutraFonte(db, { cargo: 'Fisioterapeuta', cidade: 'Recife' }, AGORA);
  assert.equal(r.novo, false);
  assert.equal(r.pedido?.status, 'rodando');
  assert.equal(inserts.length, 0);
});

test('pedido: InfoJobs coletado há menos de 20 h não pede de novo', async () => {
  const { db, inserts } = banco({ ultimaInfojobs: minutosAtras(60 * 5) });
  const r = await pedirOutraFonte(db, { cargo: 'Fisioterapeuta', cidade: 'Recife' }, AGORA);
  assert.equal(r.novo, false);
  assert.equal(inserts.length, 0);
});

// Alternar entre buscas salvas refazia o pedido a cada clique.
test('pedido: concluído há menos de 20 h, mesmo com falha, não pede de novo', async () => {
  for (const status of ['falhou', 'pronto', 'adiado', 'sem_uf'] as const) {
    const { db, inserts } = banco({ pedido: pedido({ status, pedido_em: minutosAtras(3) }) });
    const r = await pedirOutraFonte(db, { cargo: 'Fisioterapeuta', cidade: 'Recife' }, AGORA);
    assert.equal(r.novo, false, status);
    assert.equal(inserts.length, 0, status);
  }
  const { db, inserts } = banco({ pedido: pedido({ status: 'falhou', pedido_em: minutosAtras(60 * 21) }) });
  assert.equal((await pedirOutraFonte(db, { cargo: 'Fisioterapeuta', cidade: 'Recife' }, AGORA)).novo, true);
  assert.equal(inserts.length, 1);
});

test('pedido: andamento expirado não trava o par para sempre', async () => {
  const { db, inserts } = banco({ pedido: pedido({ pedido_em: minutosAtras(40) }) });
  const r = await pedirOutraFonte(db, { cargo: 'Fisioterapeuta', cidade: 'Recife' }, AGORA);
  assert.equal(r.novo, true);
  assert.equal(inserts.length, 1);
});

test('disparo: chama o workflow certo e só aceita 204', async () => {
  let chamada: { url: string; corpo: unknown; auth: string | null } | null = null;
  const ok = (async (url: string | URL, init?: RequestInit) => {
    chamada = {
      url: String(url),
      corpo: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get('authorization'),
    };
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  assert.equal(await dispararColeta({ token: 't', repo: 'dono/repo', buscar: ok }), true);
  assert.deepEqual(chamada, {
    url: 'https://api.github.com/repos/dono/repo/actions/workflows/outra-fonte.yml/dispatches',
    corpo: { ref: 'main' },
    auth: 'Bearer t',
  });

  const negado = (async () => new Response('{}', { status: 404 })) as typeof fetch;
  assert.equal(await dispararColeta({ token: 't', repo: 'dono/repo', buscar: negado }), false);
  const caiu = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  assert.equal(await dispararColeta({ token: 't', repo: 'dono/repo', buscar: caiu }), false);
});
