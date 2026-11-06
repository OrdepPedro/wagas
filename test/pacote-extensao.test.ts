import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { arquivosDoPacote, zip } from '../src/extensao/pacote.ts';

describe('pacote da extensão', () => {
  const arquivos = arquivosDoPacote('extensao', 'https://wagas.example/qualquer/caminho');

  it('aponta config.js e host_permissions só para o site de produção', () => {
    assert.equal(arquivos.get('config.js')!.toString(), 'export const SITE = "https://wagas.example";\n');
    const manifest = JSON.parse(arquivos.get('manifest.json')!.toString());
    assert.deepEqual(manifest.host_permissions, ['https://wagas.example/*']);
    assert.ok(![...arquivos.values()].some((b) => b.toString('latin1').includes('localhost:3000/*')));
  });

  it('leva só os arquivos da extensão, nada da pasta da loja', () => {
    for (const nome of arquivos.keys()) assert.match(nome, /^[^/]+\.(json|js|html|css|png)$/);
    for (const essencial of ['manifest.json', 'painel.html', 'painel.js', 'fundo.js', 'icone.png']) {
      assert.ok(arquivos.has(essencial), essencial);
    }
  });

  it('recusa site sem https', () => {
    assert.throws(() => arquivosDoPacote('extensao', 'http://wagas.example'));
  });

  it('o zip devolve os mesmos bytes', () => {
    const z = zip(arquivos);
    let pos = 0;
    const lidos = new Map<string, Buffer>();
    while (z.readUInt32LE(pos) === 0x04034b50) {
      const tam = z.readUInt32LE(pos + 18);
      const n = z.readUInt16LE(pos + 26);
      const nome = z.subarray(pos + 30, pos + 30 + n).toString();
      lidos.set(nome, inflateRawSync(z.subarray(pos + 30 + n, pos + 30 + n + tam)));
      pos += 30 + n + tam;
    }
    assert.deepEqual([...lidos.keys()], [...arquivos.keys()]);
    for (const [nome, dado] of arquivos) assert.ok(lidos.get(nome)!.equals(dado), nome);
  });
});
