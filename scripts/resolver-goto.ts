// Recupera as linhas de `raw_results` gravadas com o redirect `google.com/goto`
// da Serper no lugar da URL real (ver src/serper/redirect.ts). Zero crédito: a
// resposta da Serper já está no banco, só falta resolver o link.
//
//   node --env-file-if-exists=.env scripts/resolver-goto.ts          # grava
//   node --env-file-if-exists=.env scripts/resolver-goto.ts --seco   # só mede
//
// Cada linha resolvida volta para a fila do classificador (`processado = false`).
// Se a URL real já existe em `raw_results`, a linha do redirect é duplicata e
// sai do banco.

import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { dataDoSnippetGupy } from '../src/normalize/datas.ts';
import { canonicalizarUrl, hashUrl } from '../src/normalize/url.ts';
import { resolverRedirectGoogle } from '../src/serper/redirect.ts';

const seco = process.argv.includes('--seco');
const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

interface Linha {
  id: number;
  url_original: string;
  snippet: string | null;
}

const linhas = await db.selectTodos<Linha>(
  'raw_results',
  'select=id,url_original,snippet&fonte=eq.desconhecida&url_canonica=like.*google.com/goto*&order=id',
);
console.log(`${linhas.length} linhas com redirect do Google${seco ? ' (seco)' : ''}`);

const conta = { resolvida: 0, duplicada: 0, falhou: 0, aindaDesconhecida: 0 };
const porFonte: Record<string, number> = {};

for (const linha of linhas) {
  const destino = await resolverRedirectGoogle(linha.url_original);
  const canonica = destino ? canonicalizarUrl(destino) : null;
  if (!canonica) {
    conta.falhou++;
    continue;
  }
  if (canonica.fonte === 'desconhecida') conta.aindaDesconhecida++;

  const hash = hashUrl(canonica.url);
  const [existente] = await db.select<{ id: number }>('raw_results', `select=id&url_hash=eq.${hash}`);
  if (existente) {
    conta.duplicada++;
    if (!seco) await db.remove('raw_results', `id=eq.${linha.id}`);
    continue;
  }

  conta.resolvida++;
  porFonte[canonica.fonte] = (porFonte[canonica.fonte] ?? 0) + 1;
  const daGupy = canonica.fonte === 'ats_gupy' ? dataDoSnippetGupy(linha.snippet ?? '') : null;
  if (!seco) {
    await db.update('raw_results', `id=eq.${linha.id}`, {
      url_hash: hash,
      url_canonica: canonica.url,
      url_original: destino,
      fonte: canonica.fonte,
      fonte_id: canonica.fonteId,
      data_publicacao: daGupy,
      data_publicacao_origem: daGupy ? 'gupy_snippet' : 'desconhecida',
      processado: false,
      classificacao: null,
      classificacao_motivo: null,
      classificacao_estagio: null,
      classificado_em: null,
      classificador: null,
    });
  }
  await new Promise((r) => setTimeout(r, 300));
}

console.log(conta, porFonte);
if (linhas.length >= 4 && conta.falhou > linhas.length / 2) {
  console.error('Mais da metade dos redirects não resolveu.');
  process.exit(1);
}
