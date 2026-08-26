/**
 * Roda a coleta sob demanda pela linha de comando.
 *
 * Mesmo módulo que o feed chama — se funcionar aqui e não na tela, o problema
 * é de sessão ou de variável de ambiente, não da coleta. É o que separa
 * problema de produto de problema de infraestrutura sem precisar adivinhar.
 *
 *   node --env-file-if-exists=.env scripts/preencher.ts "Enfermeiro" "Belo Horizonte"
 *   node --env-file-if-exists=.env scripts/preencher.ts "Enfermeiro" --so-remoto
 *
 * Zero crédito da Serper: a fonte é a API pública da Gupy.
 */
import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { preencherSeNecessario } from '../src/fontes/sob-demanda.ts';
import { consultaDeFeed } from '../src/feed/consulta.ts';

const argumentos = process.argv.slice(2);
const soRemoto = argumentos.includes('--so-remoto');
const forcar = argumentos.includes('--forcar');
const livres = argumentos.filter((a) => !a.startsWith('--'));

const cargo = livres[0];
const cidade = livres[1] ?? null;

if (!cargo) {
  console.error('uso: preencher.ts "<cargo>" ["<cidade>"] [--so-remoto] [--forcar]');
  process.exit(1);
}

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

const antes = cidade
  ? (await db.select<{ id: number }>('jobs', consultaDeFeed({ cargo, cidade }).query)).length
  : null;

const r = await preencherSeNecessario(db, {
  cargo,
  cidade: soRemoto ? null : cidade,
  ...(soRemoto ? { soRemoto: true } : {}),
  // `--forcar` ignora o frescor. Para teste, não para produção: em produção a
  // janela de 30 minutos é justamente o que impede dez usuários virarem dez
  // varreduras da fonte externa.
  ...(forcar ? { frescorMinutos: 0 } : {}),
});

console.log(JSON.stringify(r, null, 2));

if (cidade) {
  const depois = (await db.select<{ id: number }>('jobs', consultaDeFeed({ cargo, cidade }).query))
    .length;
  console.log(`\nfeed "${cargo} / ${cidade}": ${antes} -> ${depois} vagas`);
}
