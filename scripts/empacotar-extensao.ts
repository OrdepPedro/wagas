/**
 * Gera o zip da extensão para a Chrome Web Store, apontando para o site de
 * produção. A regra do pacote está em src/extensao/pacote.ts.
 *
 *   npm run extensao -- --site=https://<site em produção>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arquivosDoPacote, zip } from '../src/extensao/pacote.ts';

function principal(): void {
  const site = process.argv.find((a) => a.startsWith('--site='))?.slice('--site='.length);
  if (!site) {
    console.error('uso: npm run extensao -- --site=https://<endereço do site em produção>');
    process.exit(1);
  }
  const arquivos = arquivosDoPacote('extensao', site);
  const versao = JSON.parse(arquivos.get('manifest.json')!.toString('utf8')).version as string;
  mkdirSync('dist', { recursive: true });
  const destino = join('dist', `wagas-extensao-${versao}.zip`);
  writeFileSync(destino, zip(arquivos));
  console.log(`${destino}: ${[...arquivos.keys()].join(', ')}`);
  console.log(`site: ${new URL(site).origin}`);
}

principal();
