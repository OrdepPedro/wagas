import test from 'node:test';
import assert from 'node:assert/strict';
import { chaveDoPar, contarPares } from '../web/lib/pares-do-dia.ts';

/**
 * O teto conta pares cargo × cidade distintos, não linhas de `buscas`. Contar
 * linhas fazia o visitante esgotar 3 buscas voltando ao mesmo feed três vezes.
 */

const linha = (cargo: string, cidade_slug: string) => ({ cargo, cidade_slug });

test('voltar ao mesmo feed não consome o teto', () => {
  const hoje = [linha('Vendedor', 'belo-horizonte'), linha('Vendedor', 'belo-horizonte'), linha('vendedor ', 'belo-horizonte')];
  const r = contarPares(hoje, chaveDoPar('Vendedor', 'belo-horizonte'), 3);
  assert.deepEqual(r, { usadas: 1, estourou: false });
});

test('par novo depois do teto estoura', () => {
  const hoje = [linha('A', 'sp'), linha('B', 'sp'), linha('C', 'sp')];
  assert.equal(contarPares(hoje, chaveDoPar('D', 'sp'), 3).estourou, true);
});

test('par já buscado hoje nunca estoura, mesmo com o teto cheio', () => {
  const hoje = [linha('A', 'sp'), linha('B', 'sp'), linha('C', 'sp')];
  assert.equal(contarPares(hoje, chaveDoPar('B', 'sp'), 3).estourou, false);
});

test('mesma função em outra cidade é outro par', () => {
  const hoje = [linha('A', 'sp'), linha('A', 'rio-de-janeiro')];
  assert.equal(contarPares(hoje, chaveDoPar('A', 'sp'), 3).usadas, 2);
});
