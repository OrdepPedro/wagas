// Coleta do InfoJobs para o cache. Só aqui, nunca no request do usuário: uma
// busca abre dezenas a centenas de páginas a uma por segundo (achado 37).
//
//   npm run infojobs -- "Auxiliar Administrativo|São Paulo|SP" "Vendedor|Belo Horizonte|MG"
//   npm run infojobs -- --seco "Enfermeiro|São Paulo|SP"     # mede sem gravar
//
// A UF é obrigatória: sem ela o InfoJobs busca o Brasil ou o estado inteiro.
//
// Sem pares na linha de comando, coleta os pares que o feed já pediu à Gupy
// (`coletas_sob_demanda`), que é a demanda real — não uma lista inventada.

import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { buscarNoInfojobs } from '../src/fontes/infojobs.ts';
import { INFOJOBS, gravarNoCache, registrarColeta, ultimaColeta } from '../src/fontes/gupy-cache.ts';

const args = process.argv.slice(2);
const seco = args.includes('--seco');
const paresDaLinha = args
  .filter((a) => !a.startsWith('--'))
  .map((a) => {
    const [cargo, cidade, uf] = a.split('|').map((s) => s.trim());
    return { cargo: cargo!, cidade: cidade || null, uf: uf || null };
  });

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

// Um dia: o InfoJobs não é sob demanda, e repetir a varredura no mesmo dia só
// gasta educação com o site.
const FRESCOR_MS = 24 * 60 * 60 * 1000;

let pares = paresDaLinha;
if (pares.length === 0) {
  const pedidos = await db.select<{ cargo_chave: string; cidade_slug: string }>(
    'coletas_sob_demanda',
    'select=cargo_chave,cidade_slug&fonte=eq.gupy_api&so_remoto=is.false&order=execucoes.desc&limit=20',
  );
  // A demanda guarda só a cidade. A UF sai do que já foi gravado em `jobs` para
  // aquela cidade, pela UF mais frequente — homônimas (Bom Jesus, Santa Luzia)
  // poderiam errar, e por isso o par sem UF conhecida é pulado, não chutado.
  const ufs = await db.select<{ cidade_slug: string; uf: string }>(
    'jobs',
    'select=cidade_slug,uf&uf=not.is.null&cidade_slug=not.is.null&limit=10000',
  );
  const contagem = new Map<string, Map<string, number>>();
  for (const l of ufs) {
    const m = contagem.get(l.cidade_slug) ?? new Map<string, number>();
    m.set(l.uf, (m.get(l.uf) ?? 0) + 1);
    contagem.set(l.cidade_slug, m);
  }
  const ufDe = (slug: string) => [...(contagem.get(slug) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // `cidade_slug` serve direto: `urlDeBusca` reaplica `slugCidade`, que é idempotente.
  pares = pedidos.map((p) => ({ cargo: p.cargo_chave, cidade: p.cidade_slug || null, uf: p.cidade_slug ? ufDe(p.cidade_slug) : null }));
}

console.log(`${pares.length} pares${seco ? ' (seco, sem gravar)' : ''}`);

for (const par of pares) {
  if (!seco) {
    const anterior = await ultimaColeta(db, par.cargo, par.cidade, false, INFOJOBS);
    if (anterior && Date.now() - anterior.getTime() < FRESCOR_MS) {
      console.log(`- ${par.cargo} / ${par.cidade ?? 'Brasil'}: coletado há menos de um dia, pulando`);
      continue;
    }
  }

  if (par.cidade && !par.uf) {
    console.log(`- ${par.cargo} / ${par.cidade}: sem UF conhecida, pulando (passe "Cargo|Cidade|UF")`);
    continue;
  }
  const r = await buscarNoInfojobs({ cargo: par.cargo, cidade: par.cidade, uf: par.uf });
  const resumo = `vistas ${r.vistos}, na janela+família+local ${r.vagas.length}, fora da janela ${r.foraDaJanela}, outra família ${r.outraFamilia}, local ${r.localNaoServe}, sem JobPosting ${r.semJobPosting}`;

  if (r.falhou) {
    // Não carimba: fonte caída não é fonte vazia (achado 24).
    console.log(`- ${par.cargo} / ${par.cidade ?? 'Brasil'}: FALHOU — listagem não respondeu`);
    continue;
  }
  if (seco) {
    console.log(`- ${par.cargo} / ${par.cidade ?? 'Brasil'}: ${resumo}`);
    continue;
  }

  const g = await gravarNoCache(db, r.vagas, { cargoBusca: par.cargo, cidadeBusca: par.cidade, soRemoto: false }, INFOJOBS);
  await registrarColeta(db, par.cargo, par.cidade, false, r.vistos, g.vagasGravadas, INFOJOBS);
  console.log(`- ${par.cargo} / ${par.cidade ?? 'Brasil'}: ${resumo} → gravadas ${g.vagasGravadas} (já no banco ${g.jaNoBanco})`);
}
