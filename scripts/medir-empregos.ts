// Sonda do Empregos.com.br como fonte (trava 10): volume na janela de 7 dias,
// família de cargo, salário publicado e sobreposição com o que já está em `jobs`.
// Zero custo. Lê só a LISTAGEM pública (`/vagas/<cargo>-em-<cidade>-<uf>/<n>`,
// liberada no robots.txt): o cartão já traz título, empresa e "Publicada há N
// dias", então são 20 vagas por requisição, uma requisição por segundo.
//
//   node --env-file-if-exists=.env scripts/medir-empregos.ts [paginas]
//
// Sem banco configurado, mede tudo menos a sobreposição.

import { writeFileSync } from 'node:fs'
import { cargoBateNoTitulo } from '../src/classificar/familia.ts'
import { SupabaseRest } from '../src/db/supabase.ts'

const ALVOS: [cargo: string, cidade: string, uf: string][] = [
  ['auxiliar administrativo', 'sao-paulo', 'sp'],
  ['analista de dados', 'sao-paulo', 'sp'],
  ['enfermeiro', 'sao-paulo', 'sp'],
  ['vendedor', 'belo-horizonte', 'mg'],
  ['product manager', 'sao-paulo', 'sp'],
]
const PAGINAS = Number(process.argv[2] ?? 15)
const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Cartao { id: string; titulo: string; empresa: string; dias: number | null; salario: string | null; pagina: number }

async function html(url: string): Promise<string | null> {
  await espera(1000)
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(25000) })
    return r.ok ? await r.text() : null
  } catch { return null }
}

const texto = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '|')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/(\| ?)+/g, '|')

export function cartoes(h: string, pagina: number): Cartao[] {
  return h.split(/(?=<a[^>]*href="\/vaga\/\d+)/).slice(1).map(bloco => {
    const t = texto(bloco)
    // O cartão abre com os dois botões; título e empresa vêm logo depois.
    const m = t.match(/Candidatar-se\|([^|]+)\|([^|]+)\|/)
    const d = t.match(/Publicada (hoje|ontem|h[aá] (\d+) dias?)/i)
    const dias = !d ? null : /hoje/i.test(d[1]!) ? 0 : /ontem/i.test(d[1]!) ? 1 : Number(d[2])
    return {
      id: bloco.match(/\/vaga\/(\d+)/)![1]!,
      titulo: m?.[1]?.trim() ?? '', empresa: m?.[2]?.trim() ?? '', dias,
      salario: t.match(/(?:A partir de |De |Até )?R\$ ?[\d.]+,\d{2}(?: a R\$ ?[\d.]+,\d{2})?/)?.[0] ?? null,
      pagina,
    }
  })
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(ltda|s\.?a|eireli|me|grupo|cia|companhia)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const palavras = (t: string) => new Set(norm(t).split(' ').filter(w => w.length > 2))
function parecido(a: string, b: string) {
  const A = palavras(a), B = palavras(b)
  return [...A].filter(w => B.has(w)).length / Math.max(1, Math.min(A.size, B.size)) >= 0.6
}

const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? new SupabaseRest(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) : null
const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

const relatorio: unknown[] = []
for (const [cargo, cidade, uf] of ALVOS) {
  const base = `https://www.empregos.com.br/vagas/${cargo.replace(/ /g, '-')}-em-${cidade}-${uf}`
  const vistos = new Map<string, Cartao>()
  let falhas = 0, totalAnunciado = '?', paginasLidas = 0
  for (let p = 1; p <= PAGINAS; p++) {
    const h = await html(p === 1 ? base : `${base}/${p}`)
    if (!h) { falhas++; continue }
    if (p === 1) totalAnunciado = h.match(/<title>([\d.]+) vagas/)?.[1] ?? '?'
    const novos = cartoes(h, p).filter(c => !vistos.has(c.id))
    if (!novos.length) break
    paginasLidas++
    for (const c of novos) vistos.set(c.id, c)
  }
  const todos = [...vistos.values()]
  const naJanela = todos.filter(c => c.dias !== null && c.dias <= 7)
  const familia = naJanela.filter(c => cargoBateNoTitulo(cargo, c.titulo).bate)

  // Sobreposição com o acervo: toda fonte, mesma cidade, mesma janela.
  let acervo: { empresa: string | null; cargo: string | null; fonte: string }[] = []
  if (db) acervo = await db.selectTodos('jobs',
    `select=empresa,cargo,fonte&ativo=is.true&cidade_slug=eq.${cidade}&data_referencia=gte.${desde}&order=id`)
  const acervoFamilia = acervo.filter(j => j.cargo && cargoBateNoTitulo(cargo, j.cargo).bate)
  const empresas = new Set(acervoFamilia.map(j => norm(j.empresa ?? '')).filter(Boolean))
  const nomeada = familia.filter(c => c.empresa && !/confidencial/i.test(c.empresa))
  const mesmaEmpresa = nomeada.filter(c => empresas.has(norm(c.empresa)))
  const mesmaVaga = mesmaEmpresa.filter(c => acervoFamilia.some(j => norm(j.empresa ?? '') === norm(c.empresa) && parecido(j.cargo ?? '', c.titulo)))

  const linha = {
    cargo, cidade, uf, totalAnunciado, paginasLidas, falhas,
    cartoes: todos.length, semTitulo: todos.filter(c => !c.titulo).length, semData: todos.filter(c => c.dias === null).length,
    naJanela: naJanela.length, naFamilia: familia.length,
    // Se a listagem ordena por data, a janela se esgota nas primeiras páginas.
    naJanelaPorPagina: Array.from({ length: paginasLidas }, (_, i) => naJanela.filter(c => c.pagina === i + 1).length).join(','),
    confidencial: familia.filter(c => /confidencial/i.test(c.empresa)).length,
    comSalario: familia.filter(c => c.salario).length,
    acervoNaFamilia: acervoFamilia.length,
    acervoPorFonte: acervoFamilia.reduce<Record<string, number>>((s, j) => ({ ...s, [j.fonte]: (s[j.fonte] ?? 0) + 1 }), {}),
    mesmaEmpresa: mesmaEmpresa.length, mesmaVaga: mesmaVaga.length,
    exemplosMesmaVaga: mesmaVaga.slice(0, 3).map(c => `${c.titulo} — ${c.empresa}`),
    cortadosPelaFamilia: naJanela.filter(c => !familia.includes(c)).slice(0, 8).map(c => c.titulo),
    vagas: familia,
  }
  const { vagas: _, ...resumo } = linha
  console.error(JSON.stringify(resumo))
  relatorio.push(linha)
}
writeFileSync(`empregos-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(relatorio, null, 2))
