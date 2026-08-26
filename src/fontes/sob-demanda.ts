/**
 * Decide se vale buscar na fonte externa antes de o feed ler o cache.
 *
 * A premissa nova do produto (decidida em 26/08) é que o usuário digita
 * qualquer cargo e recebe resultado, com consulta nova sempre que ele trocar de
 * cargo ou de cidade. Este módulo é o ponto onde isso vira comportamento — e
 * também onde ele deixa de ser um convite a varrer a fonte externa sem limite.
 *
 * A regra de frescor não é otimização, é a mesma economia da regra crítica do
 * CLAUDE.md aplicada a uma fonte gratuita: **o custo escala com pares
 * cargo×cidade distintos, não com número de usuários.** Dez pessoas pedindo
 * "Auxiliar Administrativo em São Paulo" na mesma manhã são uma varredura, não
 * dez. O que muda em relação à Serper é só a moeda — lá é crédito, aqui é
 * educação com um serviço de terceiro que não nos deve nada.
 *
 * Falhar aqui nunca pode derrubar o feed. Se a fonte estiver fora do ar, o
 * usuário vê o que já existe no cache; se o cache estiver vazio, ele vê o estado
 * vazio, que já registra a demanda.
 */
import type { SupabaseRest } from '../db/supabase.ts';
import { buscarNaGupy } from './gupy.ts';
import { gravarDaGupy, registrarColeta, ultimaColeta } from './gupy-cache.ts';
import { log } from '../logger.ts';

/**
 * Quanto tempo uma coleta continua valendo.
 *
 * Trinta minutos é escolha de produto, não medida: a janela é de 7 dias e a
 * Gupy publica ao longo do dia, então esperar meia hora por uma vaga nova não
 * muda a experiência de ninguém. Se algum dia isso for medido, o número muda.
 */
export const FRESCOR_MINUTOS = 30;

export type MotivoDoPreenchimento =
  | 'coletado'
  | 'ainda_fresco'
  | 'fonte_vazia'
  | 'fonte_indisponivel';

export interface ResultadoSobDemanda {
  preencheu: boolean;
  motivo: MotivoDoPreenchimento;
  vistos: number;
  vagasGravadas: number;
}

export interface PedidoSobDemanda {
  cargo: string;
  cidade: string | null;
  soRemoto?: boolean;
  frescorMinutos?: number;
  janelaDias?: number;
  agora?: Date;
  limite?: number;
  buscar?: typeof fetch;
}

export async function preencherSeNecessario(
  db: SupabaseRest,
  pedido: PedidoSobDemanda,
): Promise<ResultadoSobDemanda> {
  const agora = pedido.agora ?? new Date();
  const soRemoto = Boolean(pedido.soRemoto);
  const frescor = (pedido.frescorMinutos ?? FRESCOR_MINUTOS) * 60_000;

  try {
    const anterior = await ultimaColeta(db, pedido.cargo, pedido.cidade, soRemoto);
    if (anterior && agora.getTime() - anterior.getTime() < frescor) {
      return { preencheu: false, motivo: 'ainda_fresco', vistos: 0, vagasGravadas: 0 };
    }

    const resposta = await buscarNaGupy({
      cargo: pedido.cargo,
      cidade: pedido.cidade,
      soRemoto,
      janelaDias: pedido.janelaDias,
      limite: pedido.limite,
      agora,
      ...(pedido.buscar ? { buscar: pedido.buscar } : {}),
    });

    // Fonte caída não é fonte vazia. Carimbar aqui daria à próxima visita a
    // resposta "já busquei recentemente" para uma busca que nunca aconteceu.
    if (resposta.falhou && resposta.vagas.length === 0) {
      return { preencheu: false, motivo: 'fonte_indisponivel', vistos: 0, vagasGravadas: 0 };
    }

    const gravacao = await gravarDaGupy(db, resposta.vagas, {
      cargoBusca: pedido.cargo,
      cidadeBusca: pedido.cidade,
      soRemoto,
    });

    // O carimbo vale mesmo quando a fonte não trouxe nada: "procurei e não tem"
    // é informação, e sem registrá-la a próxima visita procuraria de novo.
    await registrarColeta(
      db,
      pedido.cargo,
      pedido.cidade,
      soRemoto,
      resposta.vistos,
      gravacao.vagasGravadas,
    );

    return {
      preencheu: true,
      motivo: resposta.vistos === 0 ? 'fonte_vazia' : 'coletado',
      vistos: resposta.vistos,
      vagasGravadas: gravacao.vagasGravadas,
    };
  } catch (falha) {
    log.warn('coleta sob demanda falhou', {
      cargo: pedido.cargo,
      cidade: pedido.cidade,
      erro: String(falha).slice(0, 200),
    });
    return { preencheu: false, motivo: 'fonte_indisponivel', vistos: 0, vagasGravadas: 0 };
  }
}
