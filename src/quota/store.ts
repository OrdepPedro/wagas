/**
 * Contador de cota persistido.
 *
 * Modelo: a rodada RESERVA o orçamento antes de disparar qualquer query e
 * DEVOLVE o que não usou no fim. Reservar antes (e não incrementar depois) é o
 * que impede duas execuções simultâneas — cron atrasado + workflow_dispatch —
 * de somarem mais de 100 no mesmo dia.
 *
 * O runner do GitHub Actions é efêmero: o contador não pode viver em disco lá.
 * A fonte de verdade em produção é o Postgres (SupabaseQuotaStore); o
 * ArquivoQuotaStore existe para rodar local sem banco.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SupabaseRest } from '../db/supabase.ts';

export interface EstadoQuota {
  /** A chave do saldo: 'serper' (acumulado) ou 'pse:AAAA-MM-DD' (por dia). */
  dia: string;
  consumidas: number;
  limite: number;
}

export interface QuotaStore {
  /** Reserva até `pedidas` créditos. Retorna quantos foram concedidos (0..pedidas). */
  reservar(chave: string, pedidas: number, limite: number): Promise<number>;
  /** Devolve créditos reservados e não usados. */
  devolver(chave: string, quantidade: number): Promise<void>;
  estado(chave: string, limite: number): Promise<EstadoQuota>;
}

// ---------------------------------------------------------------------------
// Postgres (produção)
// ---------------------------------------------------------------------------

export class SupabaseQuotaStore implements QuotaStore {
  #db: SupabaseRest;

  constructor(db: SupabaseRest) {
    this.#db = db;
  }

  /** `reservar_saldo` faz SELECT ... FOR UPDATE: a reserva é atômica entre rodadas. */
  async reservar(chave: string, pedidas: number, limite: number): Promise<number> {
    const concedidas = await this.#db.rpc<number>('reservar_saldo', {
      p_chave: chave,
      p_pedidos: pedidas,
      p_limite: limite,
    });
    return Number(concedidas ?? 0);
  }

  async devolver(chave: string, quantidade: number): Promise<void> {
    if (quantidade <= 0) return;
    await this.#db.rpc<number>('devolver_saldo', { p_chave: chave, p_devolvidos: quantidade });
  }

  async estado(chave: string, limite: number): Promise<EstadoQuota> {
    const linhas = await this.#db.select<{ consumidos: number; limite: number }>(
      'api_saldo',
      `select=consumidos,limite&chave=eq.${encodeURIComponent(chave)}`,
    );
    const linha = linhas[0];
    return linha
      ? { dia: chave, consumidas: linha.consumidos, limite: linha.limite }
      : { dia: chave, consumidas: 0, limite };
  }
}

// ---------------------------------------------------------------------------
// Arquivo (execução local / --no-db)
// ---------------------------------------------------------------------------

export class ArquivoQuotaStore implements QuotaStore {
  #caminho: string;

  constructor(caminho = '.quota/pse-quota.json') {
    this.#caminho = caminho;
  }

  #ler(): Record<string, number> {
    try {
      const bruto = readFileSync(this.#caminho, 'utf8');
      const dados: unknown = JSON.parse(bruto);
      if (dados && typeof dados === 'object') return dados as Record<string, number>;
      return {};
    } catch {
      return {};
    }
  }

  #gravar(dados: Record<string, number>): void {
    mkdirSync(dirname(this.#caminho), { recursive: true });
    const temporario = `${this.#caminho}.tmp`;
    writeFileSync(temporario, JSON.stringify(dados, null, 2), 'utf8');
    renameSync(temporario, this.#caminho);
  }

  async reservar(dia: string, pedidas: number, limite: number): Promise<number> {
    const dados = this.#ler();
    const consumidas = dados[dia] ?? 0;
    const concedidas = Math.max(0, Math.min(pedidas, limite - consumidas));
    if (concedidas > 0) {
      dados[dia] = consumidas + concedidas;
      this.#gravar(dados);
    }
    return concedidas;
  }

  async devolver(dia: string, quantidade: number): Promise<void> {
    if (quantidade <= 0) return;
    const dados = this.#ler();
    dados[dia] = Math.max(0, (dados[dia] ?? 0) - quantidade);
    this.#gravar(dados);
  }

  async estado(dia: string, limite: number): Promise<EstadoQuota> {
    return { dia, consumidas: this.#ler()[dia] ?? 0, limite };
  }
}
