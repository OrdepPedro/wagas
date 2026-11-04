import test from 'node:test';
import assert from 'node:assert/strict';
import { cargosDaColeta, jaNaPreCarga, juntarCargos, validarCargo } from '../src/cargos/abrangidos.ts';

test('validarCargo limpa espaço e aceita pontuação de título de cargo', () => {
  assert.deepEqual(validarCargo('  Técnico(a)   de Enfermagem '), { cargo: 'Técnico(a) de Enfermagem' });
  assert.deepEqual(validarCargo('Desenvolvedor Front-end'), { cargo: 'Desenvolvedor Front-end' });
  assert.deepEqual(validarCargo('Analista de P&D'), { cargo: 'Analista de P&D' });
});

test('validarCargo recusa link, número, curto e longo', () => {
  assert.ok('erro' in validarCargo('ab'));
  assert.ok('erro' in validarCargo('x'.repeat(61)));
  assert.ok('erro' in validarCargo('https://spam.com'));
  assert.ok('erro' in validarCargo('Vendedor 2026'));
  assert.ok('erro' in validarCargo('-Vendedor'));
});

test('juntarCargos põe um por família, pré-carga primeiro', () => {
  const lista = juntarCargos(['Enfermeiro', 'Vendedor'], ['Enfermeira', 'Garçom', 'garçom']);
  assert.deepEqual(lista, ['Enfermeiro', 'Vendedor', 'Garçom']);
});

test('jaNaPreCarga reconhece a mesma família com outra grafia', () => {
  assert.equal(jaNaPreCarga('Enfermeira', ['Enfermeiro']), 'Enfermeiro');
  assert.equal(jaNaPreCarga('Garçom', ['Enfermeiro']), null);
});

test('cargosDaColeta mantém a pré-carga inteira, mesmo com família repetida', () => {
  const lista = cargosDaColeta(
    ['Auxiliar Administrativo', 'Assistente Administrativo'],
    ['Assistente Administrativa', 'Garçom'],
  );
  assert.deepEqual(lista, ['Auxiliar Administrativo', 'Assistente Administrativo', 'Garçom']);
});
