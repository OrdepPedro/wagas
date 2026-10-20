// Sonda de Greenhouse, Lever e Ashby como fontes (trava 10).
// Zero crédito: APIs públicas de job board, sem chave. Slugs chutados
// a partir de empresas brasileiras conhecidas — a descoberta por SERP
// fica para depois, se a sonda justificar.
//
// Mede, por plataforma: slugs vivos, vagas no Brasil, % com data,
// % com descrição completa e % publicadas nos últimos 7 dias.

const SLUGS = [
  'nubank', 'quintoandar', 'ifood', 'stone', 'stonepagamentos', 'creditas', 'loft',
  'vtex', 'wildlifestudios', 'picpay', 'ebanx', 'hotmart', 'olist', 'cloudwalk',
  'inter', 'c6bank', 'wellhub', 'gympass', 'pismo', 'dock', 'zenvia', 'contaazul',
  'rdstation', 'contasimples', 'cora', 'neon', 'willbank', 'kovi', 'loggi',
  'madeiramadeira', 'petlove', 'buser', 'gupy', 'jusbrasil', 'nuvemshop',
  'tiendanube', 'conta-simples', 'cobli', 'blip', 'take', 'cielo', 'pagbank',
  'mercadobitcoin', 'xpinc', 'btgpactual', 'bancopan', 'facily', 'sallve',
  'trybe', 'alura', 'descomplica', 'vittude', 'zippi', 'flash', 'caju', 'swile',
  'clicksign', 'unico', 'idwall', 'omie', 'arco', 'sami', 'alice', 'dasa',
  'liv-up', 'daki', 'frubana', 'tembici', 'quinto-andar', 'bossanova', 'asaas',
]

const SETE_DIAS = 7 * 24 * 3600 * 1000
const agora = Date.now()

type Vaga = { titulo: string; local: string; data: number | null; descricao: number }

const BR = /brasil|brazil|são paulo|sao paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|florian|recife|campinas|remote.*(br|latam)|\bSP\b|\bRJ\b|\bMG\b/i

async function json(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

async function greenhouse(slug: string): Promise<Vaga[] | null> {
  const d = await json(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`) as any
  if (!d?.jobs?.length) return null
  return d.jobs.map((j: any) => ({
    titulo: j.title,
    local: j.location?.name ?? '',
    data: j.first_published ? Date.parse(j.first_published) : (j.updated_at ? null : null),
    descricao: (j.content ?? '').length,
  }))
}

async function lever(slug: string): Promise<Vaga[] | null> {
  const d = await json(`https://api.lever.co/v0/postings/${slug}?mode=json`) as any
  if (!Array.isArray(d) || !d.length) return null
  return d.map((j: any) => ({
    titulo: j.text,
    local: [j.categories?.location, j.country, j.workplaceType].filter(Boolean).join(' '),
    data: j.createdAt ?? null,
    descricao: (j.descriptionPlain ?? '').length + (j.lists ?? []).reduce((n: number, l: any) => n + (l.content ?? '').length, 0),
  }))
}

async function ashby(slug: string): Promise<Vaga[] | null> {
  const d = await json(`https://api.ashbyhq.com/posting-api/job-board/${slug}`) as any
  if (!d?.jobs?.length) return null
  return d.jobs.map((j: any) => ({
    titulo: j.title,
    local: [j.location, j.address?.postalAddress?.addressCountry, j.workplaceType].filter(Boolean).join(' '),
    data: j.publishedAt ? Date.parse(j.publishedAt) : null,
    descricao: (j.descriptionPlain ?? '').length,
  }))
}

const plataformas = { greenhouse, lever, ashby }
const relatorio: Record<string, any> = {}

for (const [nome, f] of Object.entries(plataformas)) {
  const vivos: Record<string, { total: number; br: number }> = {}
  const todasBr: Vaga[] = []
  for (const slug of SLUGS) {
    const vagas = await f(slug)
    if (!vagas) continue
    const br = vagas.filter(v => BR.test(v.local))
    vivos[slug] = { total: vagas.length, br: br.length }
    todasBr.push(...br)
  }
  const n = todasBr.length || 1
  relatorio[nome] = {
    slugsVivos: Object.keys(vivos).length,
    porSlug: vivos,
    vagasBr: todasBr.length,
    comData: `${Math.round(100 * todasBr.filter(v => v.data).length / n)}%`,
    descricaoMais500: `${Math.round(100 * todasBr.filter(v => v.descricao > 500).length / n)}%`,
    ultimos7dias: todasBr.filter(v => v.data && agora - v.data <= SETE_DIAS).length,
  }
}

console.log(JSON.stringify(relatorio, null, 2))
