/**
 * Preenche `buscas.cargo_familia` nas linhas anteriores à migration 0007.
 *
 * Sem isso a view `demanda_descoberta` cai no `coalesce` para o texto cru, e a
 * fila volta a ficar fragmentada por grafia — que é exatamente o defeito que a
 * 0007 existe para consertar. Custo zero: só recalcula em TS o que já está
 * gravado.
 */
import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { chaveDeFamilia } from '../src/classificar/familia.ts';

const aplicar = process.argv.includes('--aplicar');
const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

const linhas = await db.select<{ id: number; cargo: string }>(
  'buscas',
  'select=id,cargo&cargo_familia=is.null',
);
console.log(`buscas sem cargo_familia: ${linhas.length}`);

// Um PATCH por chave distinta, não por linha: com muitas buscas isso é a
// diferença entre 5 requisições e 500.
const porChave = new Map<string, number[]>();
for (const l of linhas) {
  const chave = chaveDeFamilia(l.cargo);
  const ids = porChave.get(chave);
  if (ids) ids.push(l.id);
  else porChave.set(chave, [l.id]);
}

for (const [chave, ids] of porChave) {
  console.log(`  ${chave.padEnd(30)} <- ${ids.length} linha(s)`);
  if (aplicar) await db.update('buscas', `id=in.(${ids.join(',')})`, { cargo_familia: chave });
}

console.log(aplicar ? '\naplicado.' : '\nnada gravado. rode com --aplicar');
