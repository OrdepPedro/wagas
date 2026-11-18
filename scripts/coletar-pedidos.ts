// Coleta do InfoJobs para os pares que a busca pediu (`pedidos_outra_fonte`).
// Roda no workflow `outra-fonte.yml`, disparado pela busca; nunca no request.
//
//   node --env-file-if-exists=.env scripts/coletar-pedidos.ts
//
// Processa os pendentes do mais antigo para o mais novo, até a fila esvaziar:
// o workflow tem concorrência 1, e um disparo que chega com outro rodando é
// atendido por este laço.
//
// Uma requisição por segundo ao InfoJobs, no total. Se a coleta diária estiver
// rodando, ela já está gastando esse ritmo: os pendentes viram `adiado`, e o
// par entra na coleta diária seguinte (ele já está em `buscas`).

import { ufMaisFrequente } from '../src/coleta/pares.ts';
import type { Pedido } from '../src/coleta/outra-fonte.ts';
import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { INFOJOBS, gravarNoCache, idsConhecidosDoInfojobs, registrarColeta } from '../src/fontes/gupy-cache.ts';
import { buscarNoInfojobs } from '../src/fontes/infojobs.ts';

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

const filtro = (p: Pedido) =>
  `cargo_chave=eq.${encodeURIComponent(p.cargo_chave)}&cidade_slug=eq.${encodeURIComponent(p.cidade_slug)}`;
const marcar = (p: Pedido, campos: Record<string, unknown>) => db.update('pedidos_outra_fonte', filtro(p), campos);
const agoraIso = () => new Date().toISOString();

/** A coleta diária está rodando? Sem token (rodando local), assume que não. */
async function coletaDiariaRodando(): Promise<boolean> {
  const token = process.env['GITHUB_TOKEN'];
  const repo = process.env['GITHUB_REPOSITORY'];
  if (!token || !repo) return false;
  const r = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/coleta-diaria.yml/runs?status=in_progress&per_page=1`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } },
  );
  if (!r.ok) return false;
  const corpo = (await r.json()) as { total_count?: number };
  return (corpo.total_count ?? 0) > 0;
}

const placar = { pronto: 0, falhou: 0, adiado: 0, sem_uf: 0 };
// Quem pediu está olhando "Consultando outra fonte…": não reabrir vaga já gravada.
const conhecidos = await idsConhecidosDoInfojobs(db);

while (true) {
  const [pedido] = await db.select<Pedido>(
    'pedidos_outra_fonte',
    'select=*&status=eq.pendente&order=pedido_em.asc&limit=1',
  );
  if (!pedido) break;

  if (await coletaDiariaRodando()) {
    const pendentes = await db.select<Pedido>('pedidos_outra_fonte', 'select=*&status=eq.pendente');
    for (const p of pendentes) await marcar(p, { status: 'adiado', motivo: 'coleta diária rodando', concluido_em: agoraIso() });
    placar.adiado += pendentes.length;
    console.log(`Coleta diária rodando: ${pendentes.length} pedidos adiados`);
    break;
  }

  await marcar(pedido, { status: 'rodando', iniciado_em: agoraIso() });
  const rotulo = `${pedido.cargo} / ${pedido.cidade}`;

  try {
    // A busca guarda só a cidade. A UF sai do acervo, como na coleta diária;
    // sem UF conhecida o par é pulado, não chutado (cidades homônimas).
    const linhas = await db.select<{ cidade_slug: string; uf: string }>(
      'jobs',
      `select=cidade_slug,uf&cidade_slug=eq.${encodeURIComponent(pedido.cidade_slug)}&uf=not.is.null&limit=500`,
    );
    const uf = ufMaisFrequente(linhas).get(pedido.cidade_slug);
    if (!uf) {
      await marcar(pedido, { status: 'sem_uf', concluido_em: agoraIso() });
      placar.sem_uf++;
      console.log(`- ${rotulo}: sem UF conhecida, pulado`);
      continue;
    }

    const r = await buscarNoInfojobs({ cargo: pedido.cargo, cidade: pedido.cidade, uf, conhecidos });
    if (r.falhou) {
      // Fonte caída não é fonte vazia: não carimba `coletas_sob_demanda`.
      await marcar(pedido, { status: 'falhou', motivo: 'listagem não respondeu', concluido_em: agoraIso() });
      placar.falhou++;
      console.log(`- ${rotulo}: FALHOU`);
      continue;
    }

    const g = await gravarNoCache(db, r.vagas, { cargoBusca: pedido.cargo, cidadeBusca: pedido.cidade, soRemoto: false }, INFOJOBS);
    await registrarColeta(db, pedido.cargo, pedido.cidade, false, r.vistos, g.vagasGravadas, INFOJOBS);
    await marcar(pedido, { status: 'pronto', vagas_gravadas: g.vagasGravadas, concluido_em: agoraIso() });
    placar.pronto++;
    console.log(`- ${rotulo} (${uf}): vistas ${r.vistos}, gravadas ${g.vagasGravadas}`);
  } catch (erro) {
    await marcar(pedido, { status: 'falhou', motivo: String(erro).slice(0, 200), concluido_em: agoraIso() });
    placar.falhou++;
    console.log(`- ${rotulo}: erro ${String(erro).slice(0, 200)}`);
  }
}

console.log(placar);
if (placar.falhou > 0 && placar.falhou >= placar.pronto) {
  console.error('A maioria dos pedidos falhou: o endereço ou o layout do InfoJobs pode ter mudado.');
  process.exit(1);
}
