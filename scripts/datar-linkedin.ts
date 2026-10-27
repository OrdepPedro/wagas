// Grava a data de publicação real nas vagas do LinkedIn Jobs, lida da página
// pública de cada uma (achado 41). Roda depois do classificador, no Actions.
//
//   node --env-file-if-exists=.env scripts/datar-linkedin.ts            # grava
//   node --env-file-if-exists=.env scripts/datar-linkedin.ts --seco     # só lê
//   ... --limite=10
//
// Só pega linha sem data e coletada nos últimos 14 dias (`--dias=N` muda): com `qdr:w`, nada mais
// velho que isso pode estar na janela. Não corta nada por conta própria — com a
// data real, `data_referencia` deixa de ser a data de coleta e o feed tira
// sozinho o que passou de 7 dias.
//
// Uma requisição a cada 20 s: com 8 s o LinkedIn devolveu 429 em 2 de 8
// (achado 38); com 20 s, 0 de 30 (achado 41). FALHA ALTO se mais da metade das
// páginas falhar, como a coleta diária.

import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { lerPaginaDoLinkedin } from '../src/fontes/linkedin-pagina.ts';

const args = process.argv.slice(2);
const seco = args.includes('--seco');
const limite = Number(args.find((a) => a.startsWith('--limite='))?.split('=')[1] ?? 150);
const INTERVALO_MS = 20_000;

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);
const agora = new Date();
const dias = Number(args.find((a) => a.startsWith('--dias='))?.split('=')[1] ?? 14);
const desde = new Date(agora.getTime() - dias * 86_400_000).toISOString();

const linhas = await db.selectTodos<{ id: number; url: string }>(
  'jobs',
  `select=id,url&fonte=eq.linkedin_job&data_publicacao=is.null&ativo=is.true` +
    `&encerrada_em=is.null&data_coleta=gte.${desde}&order=data_coleta.desc`,
);
const fila = linhas.slice(0, limite);
console.log(`${linhas.length} vagas do LinkedIn sem data; lendo ${fila.length}${seco ? ' (seco)' : ''}`);

const conta = { datada: 0, sem_data: 0, removida: 0, falhou: 0, foraDaJanela: 0 };
for (const [i, linha] of fila.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, INTERVALO_MS));
  const l = await lerPaginaDoLinkedin(linha.url, agora);
  conta[l.tipo]++;
  if (l.tipo !== 'datada') {
    console.log(`${i + 1}/${fila.length} ${linha.id} ${l.tipo}${'motivo' in l ? ` ${l.motivo}` : ''}`);
    continue;
  }
  if (Date.parse(l.dataPublicacao) < agora.getTime() - 7 * 86_400_000) conta.foraDaJanela++;
  console.log(`${i + 1}/${fila.length} ${linha.id} "${l.texto}" -> ${l.dataPublicacao.slice(0, 10)}`);
  if (!seco) {
    await db.update('jobs', `id=eq.${linha.id}`, {
      data_publicacao: l.dataPublicacao,
      data_publicacao_origem: 'pagina_html',
    });
  }
}

console.log(conta);
if (fila.length >= 4 && conta.falhou > fila.length / 2) {
  console.error('Mais da metade das páginas do LinkedIn falhou.');
  process.exit(1);
}
