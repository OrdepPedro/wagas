// Coleta diária: Gupy + Greenhouse + InfoJobs para a pré-carga e a demanda real.
//
// A janela de 7 dias só existe com coleta contínua. Sem ela, em 21/10 o feed
// servia 79 de 373 linhas — o resto tinha expirado porque nada coletava.
//
//   npm run diaria                 # roda tudo
//   npm run diaria -- --seco       # monta a lista e mede, sem gravar
//   npm run diaria -- --so-gupy    # pula o InfoJobs (rápido, para testar)
//
// O Greenhouse não entra nos pares: baixa o quadro inteiro de cada empresa da
// lista (`src/config/greenhouse.ts`), uma requisição por quadro, e o feed filtra.
//
// Ordem: Gupy para todos os pares primeiro (segundos cada), InfoJobs depois
// (minutos cada), dentro de um orçamento de tempo. Se o tempo acabar, o que cai
// é o fim da lista — que é pré-carga, porque a demanda vem antes.
//
// FALHA ALTO: se uma fonte falhar na maioria das consultas, o processo sai com
// erro e o Actions avisa por e-mail. É o teste de saúde que faltou quando a
// Gupy ficou semanas em 404 sem ninguém saber (achado 38).
//
// Serper NÃO entra aqui: o crédito é finito (trava 9).

import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { CARGOS_PRE_CARGA, CIDADES_PRE_CARGA } from '../src/config/pre-carga.ts';
import { montarPares, ufMaisFrequente, type BuscaRegistrada } from '../src/coleta/pares.ts';
import { buscarNaGupy, vagaFechadaNaGupy } from '../src/fontes/gupy.ts';
import { buscarNoInfojobs } from '../src/fontes/infojobs.ts';
import { GUPY, INFOJOBS, gravarNoCache, idsConhecidosDoInfojobs, registrarColeta, ultimaColeta } from '../src/fontes/gupy-cache.ts';
import { coletarGreenhouse, type PlacarGreenhouse } from '../src/coleta/greenhouse.ts';
import { MAX_SUGERIDOS_NA_COLETA, cargosDaColeta } from '../src/cargos/abrangidos.ts';
import { decidirEncerramentos, type ConsultaDoDia, type VagaVerificavel } from '../src/coleta/encerramento.ts';

const args = process.argv.slice(2);
const seco = args.includes('--seco');
const soGupy = args.includes('--so-gupy');
const orcamentoMin = Number(process.env.ORCAMENTO_MINUTOS ?? 300);
const inicio = Date.now();
const minutos = () => Math.round((Date.now() - inicio) / 60000);

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);
const agora = new Date();

const [buscas, ufs] = await Promise.all([
  db.selectTodos<BuscaRegistrada>(
    'buscas',
    `select=user_id,cargo,cidade,cidade_slug,criado_em&criado_em=gte.${new Date(agora.getTime() - 30 * 864e5).toISOString()}&order=id`,
  ),
  db.selectTodos<{ cidade_slug: string | null; uf: string | null }>('jobs', 'select=cidade_slug,uf&uf=not.is.null&order=id'),
]);

// Cargos sugeridos na landing (migration 0014): entram como pré-carga, DEPOIS
// da fixa — se a madrugada não der conta do InfoJobs, quem cai são eles. Sem a
// migration, a coleta segue só com a pré-carga.
let sugeridos: Array<{ id: number; cargo: string }> = [];
try {
  sugeridos = await db.select<{ id: number; cargo: string }>(
    'cargos_sugeridos',
    `select=id,cargo&order=criado_em.desc&limit=${MAX_SUGERIDOS_NA_COLETA}`,
  );
} catch (erro) {
  console.error(`cargos_sugeridos ilegível (a migration 0014 foi aplicada?): ${String(erro).slice(0, 200)}`);
}
const cargosDoDia = cargosDaColeta(CARGOS_PRE_CARGA, sugeridos.map((s) => s.cargo));

const pares = montarPares({
  cargos: cargosDoDia,
  cidades: CIDADES_PRE_CARGA,
  buscas,
  ufPorSlug: ufMaisFrequente(ufs),
  agora,
});
const daDemanda = pares.filter((p) => p.origem === 'demanda').length;
console.log(`${pares.length} pares (${daDemanda} de demanda, ${pares.length - daDemanda} de pré-carga)${seco ? ' — SECO, sem gravar' : ''}`);

// --- Gupy: cidade de cada par + remoto do Brasil uma vez por cargo ----------
const placar = { gupy: { ok: 0, falhou: 0, gravadas: 0 }, infojobs: { ok: 0, falhou: 0, gravadas: 0, pulados: 0 } };

const consultasGupy = [
  ...pares.map((p) => ({ cargo: p.cargo, cidade: p.cidade as string | null, soRemoto: false })),
  // O feed soma remoto de todo o Brasil; um pedido por cargo cobre todas as cidades.
  ...[...new Map(pares.map((p) => [p.cargo.toLowerCase(), p.cargo])).values()].map((cargo) => ({ cargo, cidade: null, soRemoto: true })),
];

const consultasDoDia: ConsultaDoDia[] = [];
const achadasPorConsulta: Array<{ cargo: string; vagas: number }> = [];

for (const c of consultasGupy) {
  const r = await buscarNaGupy({ cargo: c.cargo, cidade: c.cidade, soRemoto: c.soRemoto, limite: 500 });
  // A Gupy recusa rajada (achado 35): uma pausa curta entre consultas.
  await new Promise((ok) => setTimeout(ok, 500));
  achadasPorConsulta.push({ cargo: c.cargo, vagas: r.vagas.length });
  consultasDoDia.push({ cargo: c.cargo, cidade: c.cidade, soRemoto: c.soRemoto, completa: r.completa, idsVistos: r.idsVistos });
  if (r.falhou && r.vagas.length === 0) { placar.gupy.falhou++; continue; }
  placar.gupy.ok++;
  if (seco) continue;
  const g = await gravarNoCache(db, r.vagas, { cargoBusca: c.cargo, cidadeBusca: c.cidade, soRemoto: c.soRemoto }, GUPY);
  await registrarColeta(db, c.cargo, c.cidade, c.soRemoto, r.vistos, g.vagasGravadas, GUPY);
  placar.gupy.gravadas += g.vagasGravadas;
}
// Quantas vagas cada sugerido achou: é o que decide se ele aparece na landing.
// Conta vagas encontradas (não só as novas): cargo de verdade que já estava no
// cache também é cargo de verdade.
if (!seco && sugeridos.length > 0) {
  const chave = (c: string) => c.trim().toLowerCase();
  const porCargo = new Map<string, number>();
  for (const s of sugeridos) porCargo.set(chave(s.cargo), 0);
  for (const r of achadasPorConsulta) {
    if (porCargo.has(chave(r.cargo))) porCargo.set(chave(r.cargo), porCargo.get(chave(r.cargo))! + r.vagas);
  }
  try {
    for (const s of sugeridos) {
      await db.update('cargos_sugeridos', `id=eq.${s.id}`, {
        coletado_em: agora.toISOString(),
        vagas_ultima_coleta: porCargo.get(chave(s.cargo)) ?? 0,
      });
    }
  } catch (erro) {
    console.error(`Falha ao marcar cargos sugeridos: ${String(erro).slice(0, 200)}`);
  }
  const comVaga = sugeridos.filter((s) => (porCargo.get(chave(s.cargo)) ?? 0) > 0).length;
  console.log(`Sugeridos: ${sugeridos.length} coletados, ${comVaga} com vaga (aparecem na landing)`);
}

console.log(`Gupy: ${placar.gupy.ok} ok, ${placar.gupy.falhou} falharam, ${placar.gupy.gravadas} vagas novas — ${minutos()} min`);

// --- Vagas encerradas: a Gupy deixou de listar (migration 0011) --------------
// Falhar aqui não pode derrubar a coleta: sem encerramento, o feed só fica como
// era antes. Mas o erro sai no log, não é engolido.
try {
  const desde = new Date(agora.getTime() - 7 * 864e5).toISOString();
  const linhas = await db.selectTodos<{
    id: number;
    url: string;
    data_publicacao: string;
    encerrada_em: string | null;
    raw_results: { fonte_id: string | null; cargo_busca: string; localizacao_busca: string | null; modelo_busca: string } | null;
  }>(
    'jobs',
    `select=id,url,data_publicacao,encerrada_em,raw_results(fonte_id,cargo_busca,localizacao_busca,modelo_busca)&fonte=eq.ats_gupy&ativo=is.true&data_publicacao=gte.${desde}&order=id`,
  );
  const vagas: VagaVerificavel[] = linhas.flatMap((l) =>
    l.raw_results?.fonte_id
      ? [{
          id: l.id,
          fonteId: l.raw_results.fonte_id,
          cargoBusca: l.raw_results.cargo_busca,
          cidadeBusca: l.raw_results.localizacao_busca,
          soRemoto: l.raw_results.modelo_busca === 'remoto',
          dataPublicacao: l.data_publicacao,
          encerradaEm: l.encerrada_em,
        }]
      : [],
  );
  const v = decidirEncerramentos(vagas, consultasDoDia, agora);

  // Sumir da listagem é a suspeita; a página da vaga dizendo "closed" é a
  // confirmação. Sem ela, 3 de 45 seriam encerradas ainda publicadas (24/10).
  const urlPorId = new Map(linhas.map((l) => [l.id, l.url]));
  const confirmadas: number[] = [];
  for (const id of v.encerrar) {
    if (await vagaFechadaNaGupy(urlPorId.get(id)!)) confirmadas.push(id);
    await new Promise((ok) => setTimeout(ok, 500));
  }
  console.log(`Encerramento (Gupy): ${vagas.length} verificáveis, ${v.encerrar.length} sumiram da listagem, ${confirmadas.length} confirmadas fechadas na página, ${v.reabrir.length} reabertas, ${consultasDoDia.filter((c) => c.completa).length}/${consultasDoDia.length} consultas completas`);
  for (const s of v.suspeitas) console.warn(`  consulta ignorada, encerraria demais — ${s}`);

  if (!seco) {
    const emLotes = async (ids: number[], campos: Record<string, unknown>) => {
      for (let i = 0; i < ids.length; i += 200) await db.update('jobs', `id=in.(${ids.slice(i, i + 200).join(',')})`, campos);
    };
    await emLotes(confirmadas, { encerrada_em: agora.toISOString() });
    await emLotes(v.reabrir, { encerrada_em: null });
  }
} catch (erro) {
  console.error(`Encerramento falhou (a migration 0011 foi aplicada?): ${String(erro).slice(0, 300)}`);
}

// --- Greenhouse: quadro inteiro por empresa, ~15 s no total ------------------
// Erro na gravação (a migration 0022 não aplicada, por exemplo) não derruba a
// coleta do InfoJobs: vira problema de saúde no fim, e o job falha alto.
let greenhouse: PlacarGreenhouse | null = null;
let erroGreenhouse: string | null = null;
try {
  greenhouse = await coletarGreenhouse(db, { seco, agora });
  console.log(`Greenhouse: ${greenhouse.ok} quadros ok, ${greenhouse.falhou} falharam, ${greenhouse.naJanela} vagas na janela, ${greenhouse.gravadas} linhas novas, ${greenhouse.encerradas} encerradas — ${minutos()} min`);
} catch (erro) {
  erroGreenhouse = String(erro).slice(0, 300);
  console.error(`Greenhouse falhou (a migration 0022 foi aplicada?): ${erroGreenhouse}`);
}

// --- InfoJobs: por par, dentro do orçamento de tempo -------------------------
if (!soGupy) {
  // Vaga já em `jobs` não tem a página aberta de novo, e o que esta execução lê
  // entra no conjunto: o mesmo anúncio aparece em vários pares do mesmo dia.
  const conhecidos = await idsConhecidosDoInfojobs(db, agora);
  const ij = { requisicoes: 0, jaConhecidas: 0, cortadasNaListagem: 0, paginasAbertas: 0 };
  for (const p of pares) {
    if (minutos() >= orcamentoMin) {
      console.log(`Orçamento de ${orcamentoMin} min esgotado; ${pares.length - placar.infojobs.ok - placar.infojobs.falhou - placar.infojobs.pulados} pares ficam para amanhã`);
      break;
    }
    if (!p.uf) { placar.infojobs.pulados++; continue; }
    if (!seco) {
      // 20h, não 24h: o horário de início varia alguns minutos entre execuções.
      const anterior = await ultimaColeta(db, p.cargo, p.cidade, false, INFOJOBS);
      if (anterior && Date.now() - anterior.getTime() < 20 * 3600 * 1000) { placar.infojobs.pulados++; continue; }
    }
    const r = await buscarNoInfojobs({ cargo: p.cargo, cidade: p.cidade, uf: p.uf, conhecidos });
    ij.requisicoes += r.requisicoes;
    ij.jaConhecidas += r.jaConhecidas;
    ij.cortadasNaListagem += r.cortadasNaListagem;
    ij.paginasAbertas += r.vistos;
    if (r.falhou) { placar.infojobs.falhou++; continue; }
    placar.infojobs.ok++;
    for (const v of r.vagas) conhecidos.add(v.fonteId);
    if (seco) continue;
    const g = await gravarNoCache(db, r.vagas, { cargoBusca: p.cargo, cidadeBusca: p.cidade, soRemoto: false }, INFOJOBS);
    await registrarColeta(db, p.cargo, p.cidade, false, r.vistos, g.vagasGravadas, INFOJOBS);
    placar.infojobs.gravadas += g.vagasGravadas;
  }
  console.log(`InfoJobs: ${placar.infojobs.ok} ok, ${placar.infojobs.falhou} falharam, ${placar.infojobs.pulados} pulados, ${placar.infojobs.gravadas} vagas novas — ${minutos()} min`);
  console.log(`  ${ij.requisicoes} requisições: ${ij.paginasAbertas} páginas de vaga abertas, ${ij.cortadasNaListagem} cortadas pelo cartão, ${ij.jaConhecidas} já conhecidas`);
}

// --- Saúde: falha alta faz o job falhar, e o Actions manda e-mail ------------
const doente = (ok: number, falhou: number) => falhou > 0 && falhou >= ok;
const problemas = [
  doente(placar.gupy.ok, placar.gupy.falhou) && `Gupy falhou em ${placar.gupy.falhou} de ${placar.gupy.ok + placar.gupy.falhou} consultas`,
  erroGreenhouse && `Greenhouse: ${erroGreenhouse}`,
  greenhouse && doente(greenhouse.ok, greenhouse.falhou) && `Greenhouse falhou em ${greenhouse.falhou} de ${greenhouse.ok + greenhouse.falhou} quadros`,
  !soGupy && doente(placar.infojobs.ok, placar.infojobs.falhou) && `InfoJobs falhou em ${placar.infojobs.falhou} de ${placar.infojobs.ok + placar.infojobs.falhou} pares`,
].filter(Boolean);

if (problemas.length) {
  console.error(`FONTE COM PROBLEMA — o endereço ou o layout pode ter mudado:\n  ${problemas.join('\n  ')}`);
  process.exit(1);
}
