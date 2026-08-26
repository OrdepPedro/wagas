/**
 * Roda o feed contra o banco de verdade, pela linha de comando.
 *
 * Existe para que a consulta do Passo 4 possa ser medida antes de haver tela.
 * O que ele imprime é exatamente o que o Next.js vai receber — mesmo módulo,
 * mesma query. Se aqui vier vazio, a tela viria vazia.
 *
 *   node --env-file-if-exists=.env scripts/consultar-feed.ts "Product Manager" "São Paulo"
 *
 * Zero crédito de API externa: lê só o cache, que é a regra do CLAUDE.md.
 */
import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { consultaDeFeed, JANELA_DIAS } from '../src/feed/consulta.ts';

const [cargo = 'Product Manager', cidade = 'São Paulo'] = process.argv.slice(2);
const janelaDias = Number(process.env['FEED_JANELA_DIAS'] ?? JANELA_DIAS);

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

const consulta = consultaDeFeed({ cargo, cidade, janelaDias });
console.log(`busca: ${cargo} em ${cidade} — janela de ${janelaDias} dias`);
console.log(`domínio exigido: ${JSON.stringify(consulta.dominio)}`);
console.log(`classes aceitas: ${JSON.stringify(consulta.classes)}`);
console.log(`cidade: ${consulta.cidadeSlug}\n`);

interface Vaga {
  empresa: string;
  cargo: string;
  modelo: string | null;
  localizacao: string | null;
  cidade_slug: string | null;
  pais_br: boolean | null;
  fonte: string;
  url: string;
  data_referencia: string;
  data_publicacao: string | null;
  local_avaliado: boolean;
}

const vagas = await db.select<Vaga>('jobs', consulta.query);

if (vagas.length === 0) {
  console.log('FEED VAZIO. O par cargo × cidade não está coberto pelo cache.');
  process.exit(0);
}

for (const v of vagas) {
  const balde = v.cidade_slug === consulta.cidadeSlug ? 'cidade' : 'remoto';
  const data = v.data_publicacao ? v.data_publicacao.slice(0, 10) : `~${v.data_referencia.slice(0, 10)}`;
  const portao = v.local_avaliado ? '' : ' [local não julgado]';
  console.log(
    `${data}  ${balde.padEnd(7)} ${(v.modelo ?? '-').padEnd(10)} ${v.empresa.slice(0, 22).padEnd(24)} ${v.cargo.slice(0, 44)}${portao}`,
  );
}

const porBalde = vagas.reduce<Record<string, number>>((acc, v) => {
  const balde = v.cidade_slug === consulta.cidadeSlug ? 'cidade' : 'remoto';
  acc[balde] = (acc[balde] ?? 0) + 1;
  return acc;
}, {});
console.log(`\n${vagas.length} vagas —`, porBalde);
console.log(
  'sem data de publicação real:',
  vagas.filter((v) => !v.data_publicacao).length,
  '| sem portão de local:',
  vagas.filter((v) => !v.local_avaliado).length,
);
