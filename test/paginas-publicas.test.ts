import test from 'node:test';
import assert from 'node:assert/strict';
import { CARGOS_PRE_CARGA, CIDADES_PRE_CARGA } from '../src/config/pre-carga.ts';
import {
  caminhoDaPagina,
  PAGINAS_PUBLICAS,
  paginaPublica,
  SLUG_REMOTO,
  tituloDaPagina,
} from '../src/feed/paginas-publicas.ts';

test('uma página por par da pré-carga, mais a remota de cada cargo', () => {
  assert.equal(PAGINAS_PUBLICAS.length, CARGOS_PRE_CARGA.length * (CIDADES_PRE_CARGA.length + 1));
});

test('nenhum caminho repetido', () => {
  const caminhos = PAGINAS_PUBLICAS.map(caminhoDaPagina);
  assert.equal(new Set(caminhos).size, caminhos.length);
});

test('slug sem acento, minúsculo, com hífen — e volta para a mesma página', () => {
  const p = paginaPublica('tecnico-de-enfermagem', 'sao-paulo');
  assert.ok(p);
  assert.equal(p.cargo, 'Técnico de Enfermagem');
  assert.equal(p.cidade?.nome, 'São Paulo');
  assert.equal(caminhoDaPagina(p), '/vagas-de/tecnico-de-enfermagem/sao-paulo');
  for (const pagina of PAGINAS_PUBLICAS) {
    assert.match(caminhoDaPagina(pagina), /^\/vagas-de\/[a-z0-9-]+\/[a-z0-9-]+$/);
  }
});

test('"remoto" não colide com nenhuma cidade', () => {
  assert.ok(!PAGINAS_PUBLICAS.some((p) => p.cidade && p.cidadeSlug === SLUG_REMOTO));
  const r = paginaPublica('vendedor', SLUG_REMOTO);
  assert.equal(r?.cidade, null);
  assert.equal(r && tituloDaPagina(r), 'Vagas remotas de Vendedor');
});

test('par fora do conjunto não vira página (sem espaço infinito para o robô)', () => {
  assert.equal(paginaPublica('product-manager', 'sao-paulo'), null);
  assert.equal(paginaPublica('vendedor', 'recife'), null);
});
