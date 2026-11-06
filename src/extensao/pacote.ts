/**
 * Pacote da extensão para a Chrome Web Store (`npm run extensao`).
 *
 * A pasta `extensao/` fica apontando para `localhost:3000` (é a que se carrega
 * sem compactar para desenvolver). O pacote troca, só dentro do zip:
 *   - `config.js`: o endereço do site;
 *   - `manifest.json`: `host_permissions` só com o site de produção. Sem a
 *     permissão o Chrome não manda o cookie de sessão, e com `localhost` a
 *     revisão da loja pergunta por quê.
 *
 * Zip sem dependência: método deflate do `zlib`, `manifest.json` na raiz.
 */
import { deflateRawSync, crc32 } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Só o que a extensão usa. Texto da loja e prints ficam fora do pacote. */
const INCLUIR = /\.(json|js|html|css|png)$/;

export function arquivosDoPacote(pasta: string, site: string): Map<string, Buffer> {
  const origem = new URL(site).origin;
  if (!/^https:\/\//.test(origem)) throw new Error(`o site de produção precisa ser https: ${origem}`);

  const arquivos = new Map<string, Buffer>();
  for (const nome of readdirSync(pasta).sort()) {
    if (!INCLUIR.test(nome)) continue;
    let conteudo = readFileSync(join(pasta, nome));
    if (nome === 'config.js') {
      conteudo = Buffer.from(`export const SITE = ${JSON.stringify(origem)};\n`);
    } else if (nome === 'manifest.json') {
      const manifest = JSON.parse(conteudo.toString('utf8'));
      manifest.host_permissions = [`${origem}/*`];
      conteudo = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    }
    arquivos.set(nome, conteudo);
  }
  if (!arquivos.has('manifest.json')) throw new Error(`manifest.json não encontrado em ${pasta}`);
  return arquivos;
}

export function zip(arquivos: Map<string, Buffer>): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  // Data fixa (1/1/2026): o mesmo conteúdo gera o mesmo zip.
  const hora = 0;
  const data = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const [nome, dado] of arquivos) {
    const comprimido = deflateRawSync(dado, { level: 9 });
    const n = Buffer.from(nome, 'utf8');
    const crc = crc32(dado);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dado.length, 22);
    local.writeUInt16LE(n.length, 26);
    locais.push(local, n, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(data, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(dado.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, n);

    deslocamento += local.length + n.length + comprimido.length;
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.size, 8);
  fim.writeUInt16LE(arquivos.size, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}
