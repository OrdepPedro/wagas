/**
 * A camada paga, na fila — e só na fila.
 *
 * Esta é a peça que NÃO fica no caminho do request do usuário, e a razão é
 * aritmética, não preferência: restam ~2.100 créditos da Serper, eles não
 * renovam, e um par cargo×cidade completo custa ~18. São ~118 pares na vida
 * inteira do produto. Uma pessoa curiosa trocando de cargo dez vezes numa tarde
 * consumiria 8% disso.
 *
 * A fonte gratuita (API pública da Gupy) já responde no request e cobre bem
 * não-tech. O que sobra para a Serper é exatamente o que a Gupy não dá: cargo
 * de tecnologia, e o bloco de posts do LinkedIn, que é o diferencial declarado
 * do produto. Por isso a fila é ordenada por PESSOAS DISTINTAS que pediram e
 * não acharam — o custo escala com pares, não com usuários, então dez pedidos
 * de uma pessoa valem menos que dois pedidos de duas.
 *
 *   node --env-file-if-exists=.env scripts/coletar-demanda.ts            # mostra a fila
 *   node --env-file-if-exists=.env scripts/coletar-demanda.ts --aplicar  # coleta o topo
 *   node --env-file-if-exists=.env scripts/coletar-demanda.ts --aplicar --teto=40
 *
 * Sem `--aplicar` não gasta um crédito: imprime o que faria e quanto custaria.
 */
import { carregarConfig } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { expandirAlvo, type Alvo } from '../src/config/alvos.ts';
import { chaveDeFamilia } from '../src/classificar/familia.ts';
import { log } from '../src/logger.ts';

interface LinhaDaDemanda {
  familia: string;
  cidade_slug: string;
  termos: string[];
  pessoas: number;
  pedidos: number;
  primeiro_pedido: string;
}

interface LinhaDaFila {
  familia: string;
  cidade_slug: string;
  estado: string;
}

interface LinhaDeBusca {
  cargo: string;
  cidade: string;
  cargo_familia: string | null;
  cidade_slug: string;
}

const argumentos = process.argv.slice(2);
const aplicar = argumentos.includes('--aplicar');
const teto = Number(argumentos.find((a) => a.startsWith('--teto='))?.slice(7) ?? '40');

const config = carregarConfig({ precisaDb: true, precisaFonte: aplicar });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

// ---------------------------------------------------------------------------
// Saldo primeiro. Não faz sentido montar plano que o saldo não paga.
// ---------------------------------------------------------------------------
const saldo = await db.select<{ consumidos: number; limite: number }>(
  'api_saldo',
  'select=consumidos,limite&chave=eq.serper',
);
const restantes = saldo[0] ? saldo[0].limite - saldo[0].consumidos : config.creditosTotais;

console.log(`saldo da Serper: ${restantes} créditos`);
console.log(`teto desta execução: ${teto}\n`);

// ---------------------------------------------------------------------------
// A fila.
// ---------------------------------------------------------------------------
const demanda = await db.select<LinhaDaDemanda>(
  'demanda_descoberta',
  'select=familia,cidade_slug,termos,pessoas,pedidos,primeiro_pedido&limit=50',
);

const jaNaFila = new Set(
  (
    await db.select<LinhaDaFila>('fila_de_coleta', 'select=familia,cidade_slug,estado')
  )
    .filter((f) => f.estado === 'atendida' || f.estado === 'coletando')
    .map((f) => `${f.familia}|${f.cidade_slug}`),
);

/**
 * O termo que vai virar dork é o que o USUÁRIO escreveu, não a chave de
 * família. A chave é `enfermeiro|` — isso não é um cargo e não pode ir para o
 * `intitle:` de um dork validado. Pega-se a busca real mais recente daquela
 * família, que é texto que existe no mundo.
 */
const buscas = await db.select<LinhaDeBusca>(
  'buscas',
  'select=cargo,cidade,cargo_familia,cidade_slug&resultados=eq.0&order=criado_em.desc&limit=400',
);

function termoReal(familia: string, cidadeSlug: string): { cargo: string; cidade: string } | null {
  for (const b of buscas) {
    const chave = b.cargo_familia ?? chaveDeFamilia(b.cargo);
    if (chave === familia && b.cidade_slug === cidadeSlug) {
      return { cargo: b.cargo, cidade: b.cidade };
    }
  }
  return null;
}

const CREDITOS_POR_ALVO = expandirAlvo(
  { id: 'x', cargo: 'x', cidade: 'x', ativo: true },
  config.paginasPorConsulta,
).length;

interface Plano {
  familia: string;
  cidadeSlug: string;
  cargo: string;
  cidade: string;
  pessoas: number;
  termos: string[];
}

const plano: Plano[] = [];
let custo = 0;

for (const linha of demanda) {
  if (jaNaFila.has(`${linha.familia}|${linha.cidade_slug}`)) continue;
  const termo = termoReal(linha.familia, linha.cidade_slug);
  if (!termo) continue;
  if (custo + CREDITOS_POR_ALVO > Math.min(teto, restantes)) break;

  plano.push({
    familia: linha.familia,
    cidadeSlug: linha.cidade_slug,
    cargo: termo.cargo,
    cidade: termo.cidade,
    pessoas: linha.pessoas,
    termos: linha.termos,
  });
  custo += CREDITOS_POR_ALVO;
}

if (demanda.length === 0) {
  console.log('nenhuma demanda descoberta: todo par pedido devolveu vaga.');
  process.exit(0);
}

console.log(`demanda descoberta: ${demanda.length} famílias × cidade`);
console.log(`custo por alvo: ${CREDITOS_POR_ALVO} créditos (${config.paginasPorConsulta} páginas)\n`);

for (const linha of demanda.slice(0, 15)) {
  const noPlano = plano.some((p) => p.familia === linha.familia && p.cidadeSlug === linha.cidade_slug);
  const marca = noPlano ? '->' : jaNaFila.has(`${linha.familia}|${linha.cidade_slug}`) ? 'ok' : '  ';
  console.log(
    `${marca} ${String(linha.pessoas).padStart(3)} pessoa(s) | ${linha.familia.padEnd(28)} ${linha.cidade_slug.padEnd(20)} termos: ${linha.termos.join(', ')}`,
  );
}

console.log(`\nplano: ${plano.length} alvo(s), ${custo} créditos`);

if (!aplicar) {
  console.log('\nnada foi gasto. rode de novo com --aplicar');
  process.exit(0);
}

if (plano.length === 0) {
  console.log('nada a coletar dentro do teto.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Enfileira. A coleta em si é o `collect.ts`, que já sabe reservar saldo,
// paginar e gravar — reimplementá-la aqui criaria uma segunda rota de coleta
// com contabilidade própria, que é como o saldo some sem ninguém saber onde.
// ---------------------------------------------------------------------------
for (const p of plano) {
  await db.insert(
    'fila_de_coleta',
    [
      {
        familia: p.familia,
        cidade_slug: p.cidadeSlug,
        termo: p.cargo,
        cidade: p.cidade,
        pessoas: p.pessoas,
        estado: 'pendente',
      },
    ],
    { mesclarDuplicados: true, conflito: 'familia,cidade_slug' },
  );
}

log.info('fila atualizada', { alvos: plano.length, creditos: custo });

const alvos: Alvo[] = plano.map((p) => ({
  id: `demanda-${p.familia.replace(/[^a-z0-9]+/g, '-')}-${p.cidadeSlug}`,
  cargo: p.cargo,
  cidade: p.cidade,
  ativo: true,
}));

console.log('\nalvos enfileirados. Para coletar, acrescente a ALVOS em src/config/alvos.ts:\n');
for (const a of alvos) {
  console.log(`  { id: '${a.id}', cargo: '${a.cargo}', cidade: '${a.cidade}', ativo: true },`);
}
console.log('\ne rode: npm run collect && npm run classify');
