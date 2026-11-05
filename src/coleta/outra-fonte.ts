/**
 * Coleta do InfoJobs pedida pela busca, em segundo plano.
 *
 * Par novo recebia só a Gupy na hora e o InfoJobs no dia seguinte. Agora a
 * busca grava um pedido em `pedidos_outra_fonte` e dispara o workflow
 * `outra-fonte.yml`, que coleta só aquele par. A tela acompanha o pedido e
 * avisa quando acabar.
 *
 * O request do usuário nunca abre página do InfoJobs: a restrição 3 só permite
 * ler portal na coleta, e uma busca leva de 1 a 5 minutos a uma requisição por
 * segundo. O request só escreve o pedido e chama a API do GitHub.
 *
 * Na tela a fonte não tem nome: é "outra fonte".
 */
import type { SupabaseRest } from '../db/supabase.ts';
import { chaveDeColeta, INFOJOBS, ultimaColeta } from '../fontes/gupy-cache.ts';

export type StatusDoPedido = 'pendente' | 'rodando' | 'pronto' | 'falhou' | 'adiado' | 'sem_uf';

export interface Pedido {
  cargo_chave: string;
  cidade_slug: string;
  cargo: string;
  cidade: string;
  status: StatusDoPedido;
  pedido_em: string;
  concluido_em: string | null;
  vagas_gravadas: number | null;
}

/**
 * O que a tela diz. `null` = nada a dizer. `pedidoEm` identifica o pedido,
 * para a tela não repetir um aviso que a pessoa já viu.
 */
export type AvisoDaOutraFonte = { pedidoEm: string } & (
  | { tipo: 'consultando' }
  | { tipo: 'chegou'; vagas: number }
  | { tipo: 'nada_novo' }
  | { tipo: 'mais_tarde' }
);

/**
 * Pedido parado há mais que isso morreu: o workflow não subiu ou caiu sem
 * marcar a linha. Subir leva ~1 min e o InfoJobs, de 1 a 5 por par.
 */
export const PEDIDO_EXPIRA_MIN = 20;

/** Um pedido concluído continua aparecendo por este tempo. */
const AVISO_VALE_MIN = 120;

/** A coleta diária já pula par coletado há menos de 20 h; o pedido segue a mesma conta. */
const FRESCOR_INFOJOBS_H = 20;

export function avisoDoPedido(pedido: Pedido | null, agora: Date): AvisoDaOutraFonte | null {
  if (!pedido) return null;
  const idadeMin = (agora.getTime() - Date.parse(pedido.pedido_em)) / 60_000;
  if (idadeMin > AVISO_VALE_MIN) return null;
  const pedidoEm = pedido.pedido_em;

  switch (pedido.status) {
    case 'pendente':
    case 'rodando':
      return idadeMin > PEDIDO_EXPIRA_MIN ? { pedidoEm, tipo: 'mais_tarde' } : { pedidoEm, tipo: 'consultando' };
    case 'pronto':
      return pedido.vagas_gravadas ? { pedidoEm, tipo: 'chegou', vagas: pedido.vagas_gravadas } : { pedidoEm, tipo: 'nada_novo' };
    case 'adiado':
    case 'falhou':
      // A coleta diária cobre o par: ele já está em `buscas`.
      return { pedidoEm, tipo: 'mais_tarde' };
    case 'sem_uf':
      return null;
  }
}

function filtroDoPar(cargo: string, cidade: string): string {
  const { cargo_chave, cidade_slug } = chaveDeColeta(cargo, cidade);
  return `cargo_chave=eq.${encodeURIComponent(cargo_chave)}&cidade_slug=eq.${encodeURIComponent(cidade_slug)}`;
}

export async function lerPedido(db: SupabaseRest, cargo: string, cidade: string): Promise<Pedido | null> {
  const [linha] = await db.select<Pedido>('pedidos_outra_fonte', `select=*&${filtroDoPar(cargo, cidade)}&limit=1`);
  return linha ?? null;
}

export interface Disparo {
  token: string;
  /** "dono/repositorio" */
  repo: string;
  buscar?: typeof fetch;
}

/** `workflow_dispatch` pela API do GitHub. O workflow processa todos os pendentes. */
export async function dispararColeta(d: Disparo): Promise<boolean> {
  const buscar = d.buscar ?? fetch;
  try {
    const r = await buscar(
      `https://api.github.com/repos/${d.repo}/actions/workflows/outra-fonte.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${d.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ ref: 'main' }),
      },
    );
    return r.status === 204;
  } catch {
    return false;
  }
}

export interface ResultadoDoPedido {
  pedido: Pedido | null;
  /** true = a linha virou `pendente` agora e precisa de disparo. */
  novo: boolean;
}

/**
 * Registra o pedido, se fizer sentido. Não pede quando o InfoJobs coletou o par
 * há menos de 20 h, nem quando já há pedido em andamento: dez pessoas buscando
 * o mesmo par geram uma coleta.
 */
export async function pedirOutraFonte(
  db: SupabaseRest,
  par: { cargo: string; cidade: string },
  agora: Date = new Date(),
): Promise<ResultadoDoPedido> {
  const atual = await lerPedido(db, par.cargo, par.cidade);
  if (atual) {
    const idade = agora.getTime() - Date.parse(atual.pedido_em);
    const emAndamento = atual.status === 'pendente' || atual.status === 'rodando';
    // Em andamento: espera, até expirar. Concluído, mesmo com falha: segura o
    // par pelas mesmas 20 h. Sem isso, pedido que falha (e não carimba
    // `coletas_sob_demanda`) era refeito a cada volta à busca.
    if (emAndamento ? idade < PEDIDO_EXPIRA_MIN * 60_000 : idade < FRESCOR_INFOJOBS_H * 3_600_000) {
      return { pedido: atual, novo: false };
    }
  }

  const anterior = await ultimaColeta(db, par.cargo, par.cidade, false, INFOJOBS);
  if (anterior && agora.getTime() - anterior.getTime() < FRESCOR_INFOJOBS_H * 3_600_000) {
    return { pedido: atual, novo: false };
  }

  const linha = {
    ...chaveDeColeta(par.cargo, par.cidade),
    cargo: par.cargo.trim(),
    cidade: par.cidade.trim(),
    status: 'pendente' as const,
    pedido_em: agora.toISOString(),
    iniciado_em: null,
    concluido_em: null,
    vagas_gravadas: null,
    motivo: null,
  };
  const [gravado] = await db.insert<Pedido>('pedidos_outra_fonte', [linha], {
    mesclarDuplicados: true,
    conflito: 'cargo_chave,cidade_slug',
    retornar: true,
  });
  return { pedido: gravado ?? (linha as Pedido), novo: true };
}

/** Marca o pedido como falho quando o disparo não saiu. */
export async function marcarFalha(db: SupabaseRest, pedido: Pedido, motivo: string): Promise<void> {
  await db.update(
    'pedidos_outra_fonte',
    `${filtroDoPar(pedido.cargo, pedido.cidade)}&status=eq.pendente`,
    { status: 'falhou', motivo, concluido_em: new Date().toISOString() },
  );
}
