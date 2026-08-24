/** Leitura e validação das variáveis de ambiente. Falha cedo, com mensagem legível. */

export interface Config {
  serperKey: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  /**
   * Saldo total de créditos da Serper. Ao contrário da cota diária da PSE, este
   * é um saldo ÚNICO que não renova — o contador é acumulado, não zera por dia.
   */
  creditosTotais: number;
  /** Teto por execução, para uma rodada com bug não torrar o saldo inteiro. */
  orcamentoPorRun: number;
  paginasPorConsulta: number;
  intervaloMs: number;
  tentativas: number;
}

function obrigatoria(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) throw new Error(`variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

function numero(nome: string, padrao: number): number {
  const bruto = process.env[nome]?.trim();
  if (!bruto) return padrao;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${nome} precisa ser um número positivo (recebi "${bruto}")`);
  }
  return Math.floor(n);
}

export function carregarConfig(opts: { precisaDb: boolean; precisaFonte: boolean }): Config {
  const creditosTotais = numero('SERPER_CREDITOS_TOTAIS', 2500);
  const orcamentoPorRun = numero('SERPER_ORCAMENTO_POR_RUN', 150);

  if (orcamentoPorRun > creditosTotais) {
    throw new Error(
      `SERPER_ORCAMENTO_POR_RUN (${orcamentoPorRun}) maior que SERPER_CREDITOS_TOTAIS (${creditosTotais})`,
    );
  }

  const paginas = numero('SERPER_PAGINAS', 3);
  if (paginas > 10) throw new Error(`SERPER_PAGINAS acima de 10 (recebi ${paginas})`);

  return {
    // --dry-run só imprime os dorks: dá para inspecionar sem ter credencial.
    serperKey: opts.precisaFonte ? obrigatoria('SERPER_KEY') : '',
    supabaseUrl: opts.precisaDb ? obrigatoria('SUPABASE_URL').replace(/\/+$/, '') : '',
    supabaseServiceKey: opts.precisaDb ? obrigatoria('SUPABASE_SERVICE_KEY') : '',
    creditosTotais,
    orcamentoPorRun,
    paginasPorConsulta: paginas,
    intervaloMs: numero('SERPER_INTERVALO_MS', 200),
    tentativas: numero('SERPER_TENTATIVAS', 3),
  };
}
