import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { diaQuota } from '../src/quota/dia.ts';
import { ArquivoQuotaStore } from '../src/quota/store.ts';

const raiz = mkdtempSync(join(tmpdir(), 'wagas-quota-'));
after(() => rmSync(raiz, { recursive: true, force: true }));

let contador = 0;
function store() {
  return new ArquivoQuotaStore(join(raiz, `q${contador++}`, 'pse-quota.json'));
}

describe('diaQuota', () => {
  it('usa o fuso do Pacífico, onde a cota da PSE zera', () => {
    // 05:00Z de 21/08 ainda é 20/08 às 22h no Pacífico (PDT, UTC-7).
    assert.equal(diaQuota(new Date('2026-08-21T05:00:00Z')), '2026-08-20');
    assert.equal(diaQuota(new Date('2026-08-21T08:00:00Z')), '2026-08-21');
  });

  it('acompanha o horário de verão americano', () => {
    // Em janeiro é PST (UTC-8): 06:00Z de 15/01 é 22h de 14/01.
    assert.equal(diaQuota(new Date('2026-01-15T06:00:00Z')), '2026-01-14');
    assert.equal(diaQuota(new Date('2026-01-15T09:00:00Z')), '2026-01-15');
  });

  it('as 3 rodadas do cron caem no mesmo dia de cota', () => {
    const dias = ['09:00', '15:00', '21:00'].map((h) => diaQuota(new Date(`2026-08-21T${h}:00Z`)));
    assert.equal(new Set(dias).size, 1, `rodadas em dias de cota diferentes: ${dias.join(', ')}`);
  });
});

describe('ArquivoQuotaStore', () => {
  it('concede o que foi pedido enquanto cabe no limite', async () => {
    const s = store();
    assert.equal(await s.reservar('2026-08-21', 30, 100), 30);
    assert.deepEqual(await s.estado('2026-08-21', 100), {
      dia: '2026-08-21',
      consumidas: 30,
      limite: 100,
    });
  });

  it('nunca deixa o dia passar de 100 — trunca a última reserva', async () => {
    const s = store();
    assert.equal(await s.reservar('2026-08-21', 40, 100), 40);
    assert.equal(await s.reservar('2026-08-21', 40, 100), 40);
    assert.equal(await s.reservar('2026-08-21', 40, 100), 20, 'só sobravam 20');
    assert.equal(await s.reservar('2026-08-21', 40, 100), 0, 'acabou');
    assert.equal((await s.estado('2026-08-21', 100)).consumidas, 100);
  });

  it('devolve o que a rodada não usou', async () => {
    const s = store();
    await s.reservar('2026-08-21', 34, 100);
    await s.devolver('2026-08-21', 10);
    assert.equal((await s.estado('2026-08-21', 100)).consumidas, 24);
  });

  it('não devolve abaixo de zero nem devolve valor não positivo', async () => {
    const s = store();
    await s.reservar('2026-08-21', 5, 100);
    await s.devolver('2026-08-21', 99);
    await s.devolver('2026-08-21', -3);
    assert.equal((await s.estado('2026-08-21', 100)).consumidas, 0);
  });

  it('conta por dia, isolado', async () => {
    const s = store();
    await s.reservar('2026-08-21', 100, 100);
    assert.equal(await s.reservar('2026-08-22', 30, 100), 30);
  });

  it('sobrevive a arquivo inexistente ou corrompido', async () => {
    const s = store();
    assert.equal((await s.estado('2026-08-21', 100)).consumidas, 0);
    assert.equal(await s.reservar('2026-08-21', 3, 100), 3);
  });

  it('persiste entre instâncias — é isso que impede a 2a rodada de ignorar a 1a', async () => {
    const caminho = join(raiz, 'compartilhado', 'pse-quota.json');
    await new ArquivoQuotaStore(caminho).reservar('2026-08-21', 60, 100);
    assert.equal(await new ArquivoQuotaStore(caminho).reservar('2026-08-21', 60, 100), 40);
  });
});
