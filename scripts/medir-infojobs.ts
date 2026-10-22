// Volume do InfoJobs na janela de 7 dias, por cargo × cidade. Zero custo.
// Listagem pública ordenada por data → página de cada vaga → `datePosted`
// do JSON-LD JobPosting. Para quando a vaga passa de 7 dias. Uma requisição
// por segundo: é site de terceiro, não API.
//
// Depois compara com a Gupy no mesmo cargo × cidade (trava 10): mesma empresa
// é o teto da sobreposição; mesma empresa + título parecido é a mesma vaga.

import { buscarNaGupy } from '../src/fontes/gupy.ts'

const ALVOS: [string, string, string][] = [
  ['auxiliar administrativo', 'sao-paulo,-sp', 'São Paulo'],
  ['analista de dados', 'sao-paulo,-sp', 'São Paulo'],
  ['enfermeiro', 'sao-paulo,-sp', 'São Paulo'],
  ['vendedor', 'belo-horizonte,-mg', 'Belo Horizonte'],
  ['product manager', 'sao-paulo,-sp', 'São Paulo'],
]
const SETE_DIAS = 7 * 24 * 3600 * 1000
const MAX_PAGINAS = 30
const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

async function html(url: string): Promise<string | null> {
  await espera(1000)
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) })
    return r.ok ? await r.text() : null
  } catch { return null }
}

function jobPosting(h: string): any | null {
  for (const m of h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]!)
      for (const x of [d, ...(Array.isArray(d) ? d : d['@graph'] ?? [])])
        if (x?.['@type'] === 'JobPosting') return x
    } catch {}
  }
  return null
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(ltda|s\.?a|eireli|me|grupo|cia|companhia)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const palavras = (t: string) => new Set(norm(t).split(' ').filter(w => w.length > 2))
function parecido(a: string, b: string) {
  const A = palavras(a), B = palavras(b)
  const comum = [...A].filter(w => B.has(w)).length
  return comum / Math.max(1, Math.min(A.size, B.size)) >= 0.6
}

const relatorio: any[] = []
for (const [cargo, cidade, cidadeGupy] of ALVOS) {
  const achadas: { titulo: string; empresa: string }[] = []
  const base = `https://www.infojobs.com.br/vagas-de-emprego-${cargo.replace(/ /g, '+')}-em-${cidade}.aspx`
  const vistos = new Set<string>()
  let dentro = 0, fora = 0, falhas = 0, semData = 0, comEmpresa = 0, descricaoLonga = 0, totalAnunciado = ''
  let parou = false
  for (let p = 1; p <= MAX_PAGINAS && !parou; p++) {
    // `Page` maiúsculo e no fim: `page` minúsculo é ignorado e devolve a página 1
    const l = await html(`${base}?campo=griddate&orden=desc&Page=${p}`)
    if (!l) { falhas++; break }
    if (p === 1) totalAnunciado = l.match(/([\d.]+) Vagas de/)?.[1] ?? '?'
    const links = [...new Set([...l.matchAll(/href="(\/vaga-de-[^"]+__\d+\.aspx)"/g)].map(m => m[1]!))].filter(u => !vistos.has(u))
    if (!links.length) break
    let foraSeguidas = 0
    for (const u of links) {
      vistos.add(u)
      const d = await html(`https://www.infojobs.com.br${u}`)
      if (!d) { falhas++; continue }
      const jp = jobPosting(d)
      const t = jp?.datePosted ? Date.parse(jp.datePosted) : NaN
      if (isNaN(t)) { semData++; continue }
      if (Date.now() - t <= SETE_DIAS) {
        dentro++; foraSeguidas = 0
        if (jp.hiringOrganization?.name) comEmpresa++
        achadas.push({ titulo: jp.title ?? '', empresa: jp.hiringOrganization?.name ?? '' })
        if ((jp.description ?? '').length > 500) descricaoLonga++
      } else {
        fora++
        // destaques patrocinados furam a ordenação; 5 seguidas fora = acabou
        if (++foraSeguidas >= 5) { parou = true; break }
      }
    }
  }
  const g = await buscarNaGupy({ cargo, cidade: cidadeGupy, limite: 1000 })
  const empresasGupy = new Set(g.vagas.map(v => norm(v.empresa)))
  const mesmaEmpresa = achadas.filter(a => a.empresa && empresasGupy.has(norm(a.empresa)))
  const mesmaVaga = mesmaEmpresa.filter(a => g.vagas.some(v => norm(v.empresa) === norm(a.empresa) && parecido(v.cargo, a.titulo)))
  const linha = {
    cargo, cidade, totalAnunciado, ultimos7dias: dentro, verificadas: vistos.size, fora, semData, falhas,
    comEmpresa, descricaoLonga, terminouJanela: parou,
    gupy7dias: g.vagas.length, gupyFalhou: g.falhou,
    sobreposicaoEmpresa: mesmaEmpresa.length, sobreposicaoVaga: mesmaVaga.length,
    exemplosMesmaVaga: mesmaVaga.slice(0, 3),
    empresasInfojobs: [...new Set(achadas.map(a => a.empresa))].slice(0, 12),
    // guardadas para remedir sobreposição sem refazer o scraping
    vagasInfojobs: achadas,
  }
  console.error(JSON.stringify(linha))
  relatorio.push(linha)
}
// Arquivo direto, não stdout: o log da Gupy também escreve em stdout e
// misturava texto no JSON.
import { writeFileSync } from 'node:fs'
writeFileSync(`infojobs-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(relatorio, null, 2))
