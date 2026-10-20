// Passa os títulos já coletados do InfoJobs pelo mesmo filtro de família que a
// Gupy usa (`cargoBateNoTitulo`). Sem isso o volume do InfoJobs é o que a busca
// do site devolve, e comparar com a Gupy filtrada seria comparar coisas
// diferentes. Zero requisição: lê o JSON de `medir-infojobs.ts`.
//
//   node scripts/infojobs-familia.ts infojobs-2026-10-20.json

import { readFileSync } from 'node:fs'
import { cargoBateNoTitulo } from '../src/classificar/familia.ts'

const arquivo = process.argv[2] ?? 'infojobs-2026-10-20.json'
const relatorio = JSON.parse(readFileSync(arquivo, 'utf8')) as {
  cargo: string; cidade: string; gupy7dias: number
  vagasInfojobs: { titulo: string; empresa: string }[]
}[]

for (const r of relatorio) {
  const bate = r.vagasInfojobs.filter(v => cargoBateNoTitulo(r.cargo, v.titulo).bate)
  const cortados = r.vagasInfojobs.filter(v => !bate.includes(v)).map(v => v.titulo)
  console.log(`${r.cargo} / ${r.cidade}: bruto ${r.vagasInfojobs.length}, família ${bate.length}, gupy ${r.gupy7dias}`)
  console.log(`  cortados (amostra): ${cortados.slice(0, 6).join(' · ')}`)
}
