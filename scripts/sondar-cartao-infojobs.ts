// O cartão da listagem do InfoJobs diz a mesma coisa que a página da vaga?
//
//   node scripts/sondar-cartao-infojobs.ts [--paginas=2]
//
// O filtro de 18/11 corta pelo título e pela data do CARTÃO sem abrir a página.
// Se o cartão divergir da página, vaga boa some sem ninguém ver. Este script
// abre TODAS as páginas (o caminho antigo, lento) e compara, vaga a vaga:
//
//  - família pelo título do cartão × pelo título da página;
//  - data do cartão × data da página.
//
// O número que importa é "cortaria vaga boa": cartão fora da família ou fora da
// janela, e a página dentro. Zero crédito, 1 req/s, só leitura.
import { writeFileSync } from 'node:fs';
import { cargoBateNoTitulo, semSenioridade } from '../src/classificar/familia.ts';
import {
  blocoDaVaga,
  cartoesDaListagem,
  jobPostingDaPagina,
  normalizarJobPosting,
  urlDeBusca,
  vagaRemotaDoBloco,
} from '../src/fontes/infojobs.ts';

const PARES: Array<[string, string, string]> = [
  ['Auxiliar Administrativo', 'São Paulo', 'SP'],
  ['Vendedor', 'Belo Horizonte', 'MG'],
  ['Analista de Dados', 'São Paulo', 'SP'],
  ['Enfermeiro', 'São Paulo', 'SP'],
  ['Desenvolvedor', 'São Paulo', 'SP'],
  ['Atendente', 'Rio de Janeiro', 'RJ'],
];
const paginas = Number(process.argv.find((a) => a.startsWith('--paginas='))?.split('=')[1] ?? 2);
const agora = new Date();
const corte = agora.getTime() - 7 * 864e5;

let ultima = 0;
async function html(url: string): Promise<string | null> {
  const espera = ultima + 1000 - Date.now();
  if (espera > 0) await new Promise((ok) => setTimeout(ok, espera));
  ultima = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html' }, signal: AbortSignal.timeout(20_000) });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

const linhas: Array<Record<string, unknown>> = [];
const t = { cartoes: 0, semTituloCartao: 0, semDataCartao: 0, paginaIlegivel: 0, comparadas: 0, familiaDiverge: 0, cortariaPorFamilia: 0, cortariaPorData: 0, datasIguais: 0, difDataMaxH: 0, tituloIgual: 0 };

for (const [cargo, cidade, uf] of PARES) {
  for (let p = 1; p <= paginas; p++) {
    const lista = await html(urlDeBusca(semSenioridade(cargo), cidade, uf, p));
    if (!lista) break;
    const cartoes = cartoesDaListagem(lista);
    for (const c of cartoes) {
      t.cartoes++;
      if (c.titulo === null) t.semTituloCartao++;
      if (c.data === null) t.semDataCartao++;
      const pag = await html(c.url);
      const jp = pag ? jobPostingDaPagina(pag) : null;
      const bloco = pag ? blocoDaVaga(pag) : null;
      const vaga = jp ? normalizarJobPosting(jp, c.url) : bloco ? vagaRemotaDoBloco(bloco, c.url, agora) : null;
      if (!vaga) { t.paginaIlegivel++; continue; }
      t.comparadas++;

      const famCartao = c.titulo === null ? null : cargoBateNoTitulo(cargo, c.titulo).bate;
      const famPagina = cargoBateNoTitulo(cargo, vaga.cargo).bate;
      if (famCartao !== null && famCartao !== famPagina) t.familiaDiverge++;
      if (famCartao === false && famPagina) t.cortariaPorFamilia++;
      if (c.titulo !== null && c.titulo === vaga.cargo.replace(/\s+/g, ' ').trim()) t.tituloIgual++;

      const dCartao = c.data ? Date.parse(c.data) : null;
      const dPagina = Date.parse(vaga.dataPublicacao);
      const difH = dCartao === null ? null : (dCartao - dPagina) / 36e5;
      if (difH !== null && Math.abs(difH) < 0.02) t.datasIguais++;
      if (difH !== null) t.difDataMaxH = Math.max(t.difDataMaxH, Math.abs(difH));
      if (dCartao !== null && dCartao < corte && dPagina >= corte) t.cortariaPorData++;

      linhas.push({ cargo, cidade, id: c.id, tituloCartao: c.titulo, tituloPagina: vaga.cargo, famCartao, famPagina, dataCartao: c.data, dataPagina: vaga.dataPublicacao, origemData: vaga.origemData, difH });
    }
  }
  console.log(`${cargo} / ${cidade}: ${linhas.filter((l) => l['cargo'] === cargo).length} comparadas`);
}

const arquivo = `infojobs-cartao-${agora.toISOString().slice(0, 10)}.json`;
writeFileSync(arquivo, JSON.stringify({ totais: t, linhas }, null, 2));
console.log(t);
for (const l of linhas.filter((l) => (l['famCartao'] !== null && l['famCartao'] !== l['famPagina']) || (l['difH'] !== null && Math.abs(l['difH'] as number) >= 0.02))) {
  console.log(JSON.stringify(l));
}
console.log(`bruto em ${arquivo}`);
