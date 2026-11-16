import test from 'node:test';
import assert from 'node:assert/strict';
import { gravarNoCache, INFOJOBS } from '../src/fontes/gupy-cache.ts';
import type { SupabaseRest } from '../src/db/supabase.ts';
import type { VagaDaGupy } from '../src/fontes/gupy.ts';

function vaga(id: string, tipoContrato?: string | null): VagaDaGupy {
  return {
    fonteId: id,
    url: `https://www.infojobs.com.br/vaga-de-vendedor-em-minas-gerais__${id}.aspx`,
    cargo: 'Vendedor',
    empresa: `Loja ${id}`,
    localizacao: 'Belo Horizonte - MG',
    cidadeSlug: 'belo-horizonte',
    uf: 'MG',
    modelo: 'presencial',
    dataPublicacao: '2026-11-15T15:00:00Z',
    descricao: 'Atendimento ao cliente.',
    bruto: {},
    ...(tipoContrato === undefined ? {} : { tipoContrato }),
  };
}

/** Banco de mentira: nada existe ainda, e cada insert é guardado. */
function dbFalso() {
  const inserts: Array<{ tabela: string; linhas: Record<string, unknown>[] }> = [];
  const db = {
    select: async () => [],
    insert: async (tabela: string, linhas: Record<string, unknown>[]) => {
      inserts.push({ tabela, linhas });
      return linhas.map((l, i) => ({ id: i + 1, url_hash: l.url_hash }));
    },
  } as unknown as SupabaseRest;
  return { db, inserts };
}

test('lote com e sem contrato manda as mesmas chaves em toda linha (PGRST102)', async () => {
  const { db, inserts } = dbFalso();
  await gravarNoCache(
    db,
    [vaga('1', 'Efetivo – CLT'), vaga('2'), vaga('3', null)],
    { cargoBusca: 'Vendedor', cidadeBusca: 'Belo Horizonte', soRemoto: false },
    INFOJOBS,
  );

  for (const { tabela, linhas } of inserts) {
    const chaves = linhas.map((l) => Object.keys(l).sort().join(','));
    assert.equal(new Set(chaves).size, 1, `${tabela}: chaves diferentes no mesmo lote`);
  }
  const jobs = inserts.find((i) => i.tabela === 'jobs')!.linhas;
  assert.deepEqual(jobs.map((l) => l.tipo_contrato), ['Efetivo – CLT', null, null]);
});
