/**
 * Sonda: a página pública da vaga do LinkedIn entrega data de publicação?
 *
 * Achado 38 abriu 8 páginas com 8s de intervalo: 1 com `JobPosting`, 5 numa
 * variante sem ele, 2 com 429. Duas perguntas ficaram abertas, e esta sonda
 * mede as duas:
 *   1. A variante sem `JobPosting` traz a data em outro lugar do bloco da vaga
 *      (`posted-time-ago__text`, "há 3 dias")? Se trouxer, a precisão é de dia.
 *   2. Com intervalo maior e uma retentativa no 429, quanto sobe a taxa?
 *
 * GET anônimo, sem cookie e sem conta — não é a restrição 2. URLs frescas vêm
 * da Serper com o dork de produção (3 créditos). Uso:
 *   node --env-file-if-exists=.env scripts/sondar-linkedin-data.ts
 */
import { writeFileSync } from 'node:fs';

const CARGOS = ['Analista de Dados', 'Vendedor', 'Desenvolvedor'];
const INTERVALO_MS = 20_000;
const ESPERA_429_MS = 90_000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const chave = process.env['SERPER_KEY'];
if (!chave) throw new Error('Falta SERPER_KEY');

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function urlsDaSerper(): Promise<string[]> {
  const urls = new Set<string>();
  for (const cargo of CARGOS) {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': chave!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: `site:br.linkedin.com/jobs/view "${cargo}" "São Paulo"`,
        gl: 'br',
        hl: 'pt-br',
        tbs: 'qdr:w',
        num: 10,
      }),
    });
    const j = (await r.json()) as { organic?: { link?: string }[] };
    for (const o of j.organic ?? []) {
      const m = o.link?.match(/linkedin\.com\/jobs\/view\/(?:[^/?]*-)?(\d{8,})/);
      if (m) urls.add(`https://br.linkedin.com/jobs/view/${m[1]}`);
    }
  }
  return [...urls];
}

interface Leitura {
  url: string;
  status: number;
  tentativas: number;
  temTitulo: boolean;
  jobPosting: boolean;
  datePosted: string | null;
  tempoRelativo: string | null;
  timeDatetime: string | null;
  bytes: number;
}

function ler(url: string, status: number, tentativas: number, html: string): Leitura {
  const jp = /"@type"\s*:\s*"JobPosting"/.test(html);
  const dp = html.match(/"datePosted"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  // O bloco do topo da vaga. A lateral de similares usa outra classe
  // (`job-search-card__listdate`), então isto não lê data de outra vaga.
  const rel =
    html.match(/posted-time-ago__text[^>]*>\s*([^<]+?)\s*</)?.[1]?.trim() ?? null;
  const topo = html.split('job-search-card')[0] ?? html;
  const dt = topo.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? null;
  return {
    url,
    status,
    tentativas,
    temTitulo: /top-card-layout__title/.test(html),
    jobPosting: jp,
    datePosted: dp,
    tempoRelativo: rel,
    timeDatetime: dt,
    bytes: html.length,
  };
}

async function baixar(url: string): Promise<Leitura> {
  for (let t = 1; t <= 2; t++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
        redirect: 'follow',
      });
      const html = await r.text();
      if (r.status === 429 && t === 1) {
        await esperar(ESPERA_429_MS);
        continue;
      }
      return ler(url, r.status, t, html);
    } catch {
      if (t === 2) return ler(url, 0, t, '');
      await esperar(ESPERA_429_MS);
    }
  }
  throw new Error('inalcançável');
}

const urls = await urlsDaSerper();
console.log(`${urls.length} URLs da Serper`);
const leituras: Leitura[] = [];
for (const [i, url] of urls.entries()) {
  if (i > 0) await esperar(INTERVALO_MS);
  const l = await baixar(url);
  leituras.push(l);
  console.log(
    `${i + 1}/${urls.length} ${l.status} t${l.tentativas} jp=${l.jobPosting} dp=${l.datePosted} rel=${l.tempoRelativo} dt=${l.timeDatetime}`,
  );
}

const ok = leituras.filter((l) => l.status === 200);
const resumo = {
  urls: urls.length,
  status200: ok.length,
  status429: leituras.filter((l) => l.status === 429).length,
  outros: leituras.filter((l) => l.status !== 200 && l.status !== 429).length,
  salvasPelaRetentativa: ok.filter((l) => l.tentativas === 2).length,
  comJobPosting: ok.filter((l) => l.datePosted).length,
  semJobPostingComDataRelativa: ok.filter((l) => !l.datePosted && (l.tempoRelativo || l.timeDatetime)).length,
  semDataNenhuma: ok.filter((l) => !l.datePosted && !l.tempoRelativo && !l.timeDatetime).length,
  semTituloDaVaga: ok.filter((l) => !l.temTitulo).length,
};
console.log(resumo);
writeFileSync(
  `linkedin-data-${new Date().toISOString().slice(0, 10)}.json`,
  JSON.stringify({ resumo, leituras }, null, 2),
);
