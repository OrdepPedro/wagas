import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRest } from '../src/db/supabase.ts';
import { preencherSeNecessario } from '../src/fontes/sob-demanda.ts';

const AGORA = new Date('2026-08-26T12:00:00Z');

function vagaGupy(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Enfermeiro (a) do Trabalho',
    careerPageName: 'Afya',
    city: 'Belo Horizonte',
    state: 'Minas Gerais',
    workplaceType: 'hybrid',
    publishedDate: '2026-08-26T00:24:37.931Z',
    jobUrl: `https://afya.gupy.io/job/${id}`,
    ...extra,
  };
}

interface Chamada {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

/**
 * Banco de mentira. Registra o que foi chamado, para o teste poder afirmar
 * sobre a ORDEM e sobre o que deixou de ser chamado — que é o que importa aqui.
 */
function bancoFalso(ultimaColeta: string | null) {
  const chamadas: Chamada[] = [];

  const fetchFalso = (async (url: string | URL, init?: RequestInit) => {
    const caminho = String(url);
    const metodo = init?.method ?? 'GET';
    chamadas.push({
      metodo,
      caminho,
      corpo: init?.body ? JSON.parse(String(init.body)) : null,
    });

    if (caminho.includes('coletas_sob_demanda') && metodo === 'GET') {
      const linhas = ultimaColeta ? [{ ultima_coleta: ultimaColeta, execucoes: 1 }] : [];
      return new Response(JSON.stringify(linhas), { status: 200 });
    }
    // hashesExistentes: nada conhecido
    if (caminho.includes('raw_results') && metodo === 'GET') {
      return new Response('[]', { status: 200 });
    }
    if (metodo === 'POST' && caminho.includes('raw_results')) {
      const enviado = JSON.parse(String(init?.body)) as Array<{ url_hash: string }>;
      return new Response(
        JSON.stringify(enviado.map((l, i) => ({ id: i + 1, url_hash: l.url_hash }))),
        { status: 201 },
      );
    }
    if (metodo === 'POST' && caminho.includes('jobs')) {
      const enviado = JSON.parse(String(init?.body)) as unknown[];
      return new Response(JSON.stringify(enviado.map((_, i) => ({ id: i + 1 }))), { status: 201 });
    }
    return new Response('[]', { status: 200 });
  }) as unknown as typeof fetch;

  return { db: new SupabaseRest('https://x.supabase.co', 'chave', fetchFalso), chamadas };
}

function gupyFalsa(itens: unknown[]): typeof fetch {
  let usado = false;
  return (async () => {
    const corpo = usado ? { data: [] } : { data: itens };
    usado = true;
    return new Response(JSON.stringify(corpo), { status: 200 });
  }) as unknown as typeof fetch;
}

test('coleta quando o par nunca foi buscado', async () => {
  const { db, chamadas } = bancoFalso(null);
  const r = await preencherSeNecessario(db, {
    cargo: 'Enfermeiro',
    cidade: 'Belo Horizonte',
    agora: AGORA,
    buscar: gupyFalsa([vagaGupy(1), vagaGupy(2)]),
  });

  assert.equal(r.motivo, 'coletado');
  assert.equal(r.vagasGravadas, 2);
  assert.ok(chamadas.some((c) => c.metodo === 'POST' && c.caminho.includes('jobs')));
});

/**
 * A economia da regra crítica, aplicada a uma fonte gratuita: dez pessoas
 * pedindo o mesmo par são UMA varredura, não dez.
 */
test('não repete a varredura enquanto a coleta está fresca', async () => {
  const dezMinutosAtras = new Date(AGORA.getTime() - 10 * 60_000).toISOString();
  const { db, chamadas } = bancoFalso(dezMinutosAtras);

  const r = await preencherSeNecessario(db, {
    cargo: 'Enfermeiro',
    cidade: 'Belo Horizonte',
    agora: AGORA,
    buscar: gupyFalsa([vagaGupy(1)]),
  });

  assert.equal(r.motivo, 'ainda_fresco');
  assert.equal(r.vagasGravadas, 0);
  assert.ok(
    !chamadas.some((c) => c.metodo === 'POST'),
    'não devia ter escrito nada no banco',
  );
});

test('coleta de novo quando o frescor venceu', async () => {
  const ontem = new Date(AGORA.getTime() - 24 * 60 * 60_000).toISOString();
  const { db } = bancoFalso(ontem);

  const r = await preencherSeNecessario(db, {
    cargo: 'Enfermeiro',
    cidade: 'Belo Horizonte',
    agora: AGORA,
    buscar: gupyFalsa([vagaGupy(1)]),
  });

  assert.equal(r.motivo, 'coletado');
});

/** "Procurei e não tem" é informação: o carimbo entra mesmo com zero resultado. */
test('fonte vazia também carimba a coleta', async () => {
  const { db, chamadas } = bancoFalso(null);
  const r = await preencherSeNecessario(db, {
    cargo: 'Cargo Inexistente',
    cidade: 'Belo Horizonte',
    agora: AGORA,
    buscar: gupyFalsa([]),
  });

  assert.equal(r.motivo, 'fonte_vazia');
  assert.ok(
    chamadas.some((c) => c.metodo === 'POST' && c.caminho.includes('coletas_sob_demanda')),
    'a coleta vazia precisa ficar registrada, senão a próxima visita busca de novo',
  );
});

/** Fonte fora do ar não pode derrubar o feed: o usuário vê o cache. */
test('falha da fonte externa devolve motivo, não exceção', async () => {
  const { db } = bancoFalso(null);
  const explode = (async () => {
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch;

  const r = await preencherSeNecessario(db, {
    cargo: 'Enfermeiro',
    cidade: 'Belo Horizonte',
    agora: AGORA,
    buscar: explode,
  });

  assert.equal(r.preencheu, false);
  assert.equal(r.vagasGravadas, 0);
});

test('a linha gravada leva a data de publicação de verdade e a procedência', async () => {
  const { db, chamadas } = bancoFalso(null);
  await preencherSeNecessario(db, {
    cargo: 'Enfermeiro',
    cidade: 'Belo Horizonte',
    agora: AGORA,
    buscar: gupyFalsa([vagaGupy(1)]),
  });

  const post = chamadas.find((c) => c.metodo === 'POST' && c.caminho.includes('jobs'));
  const linha = (post?.corpo as Array<Record<string, unknown>>)[0]!;

  assert.equal(linha['data_publicacao'], '2026-08-26T00:24:37.931Z');
  assert.equal(linha['data_publicacao_origem'], 'gupy_api');
  assert.equal(linha['modelo'], 'hibrido');
  assert.equal(linha['empresa'], 'Afya');
  assert.equal(linha['cidade_slug'], 'belo-horizonte');
  assert.equal(linha['uf'], 'MG');
  assert.equal(linha['local_avaliado'], true);
  // Nada de confiança inventada: não houve estimativa nenhuma (achado 12).
  assert.equal(linha['confianca'], null);
});
