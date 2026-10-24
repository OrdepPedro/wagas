/**
 * Vaga encerrada: a fonte deixou de listar.
 *
 * A janela de 7 dias esconde vaga velha; isto esconde vaga fechada, que é a pior
 * experiência do produto — clicar e cair em "esta vaga não está mais
 * disponível". Só Gupy por enquanto: é API ordenada por data, e dá para saber se
 * a varredura foi completa. O InfoJobs termina varredura de jeitos que não
 * querem dizer "sumiu" (página que falha, destaque pago furando a ordem, teto de
 * páginas, orçamento de tempo), e encerraria vaga aberta.
 *
 * Errar para o lado de NÃO encerrar, por construção:
 *
 *  - Só conclui pela consulta que trouxe a vaga, e só se ela rodou completa
 *    hoje. Consulta que falhou, bateu no limite ou não rodou não decide nada.
 *  - Vista em QUALQUER consulta do dia, a vaga está aberta.
 *  - Só vaga publicada há menos de `margemDias`: perto do fim da janela, a
 *    paginação pode parar antes de listá-la, e sumir dali não é sinal.
 *  - Consulta que encerraria mais da metade do que trouxe é suspeita de mudança
 *    na fonte (achado 38), e é ignorada inteira.
 *  - Vaga encerrada que reaparece é reaberta: um engano dura no máximo um dia.
 */

export interface ConsultaDoDia {
  cargo: string;
  cidade: string | null;
  soRemoto: boolean;
  completa: boolean;
  idsVistos: readonly string[];
}

export interface VagaVerificavel {
  id: number;
  fonteId: string;
  /** Consulta que trouxe a vaga (`raw_results`). */
  cargoBusca: string;
  cidadeBusca: string | null;
  soRemoto: boolean;
  dataPublicacao: string;
  encerradaEm: string | null;
}

export interface Veredito {
  encerrar: number[];
  reabrir: number[];
  /** Consultas ignoradas por encerrarem demais — vão para o log. */
  suspeitas: string[];
}

const chave = (cargo: string, cidade: string | null, soRemoto: boolean) =>
  `${cargo.trim().toLowerCase()}|${(cidade ?? '').trim().toLowerCase()}|${soRemoto}`;

export function decidirEncerramentos(
  vagas: readonly VagaVerificavel[],
  consultas: readonly ConsultaDoDia[],
  agora: Date,
  opcoes: { margemDias?: number; tetoDeEncerramento?: number; minimoParaSuspeitar?: number } = {},
): Veredito {
  const margemMs = (opcoes.margemDias ?? 6) * 24 * 60 * 60 * 1000;
  const teto = opcoes.tetoDeEncerramento ?? 0.5;
  const minimo = opcoes.minimoParaSuspeitar ?? 6;

  const vistasHoje = new Set(consultas.flatMap((c) => c.idsVistos));
  const completas = new Set(consultas.filter((c) => c.completa).map((c) => chave(c.cargo, c.cidade, c.soRemoto)));

  const reabrir = vagas.filter((v) => v.encerradaEm !== null && vistasHoje.has(v.fonteId)).map((v) => v.id);

  // Candidatas agrupadas pela consulta que as trouxe, para o teto valer por consulta.
  const porConsulta = new Map<string, { total: number; sumidas: number[] }>();
  for (const v of vagas) {
    if (v.encerradaEm !== null) continue;
    if (agora.getTime() - Date.parse(v.dataPublicacao) > margemMs) continue;
    const k = chave(v.cargoBusca, v.cidadeBusca, v.soRemoto);
    if (!completas.has(k)) continue;
    const grupo = porConsulta.get(k) ?? { total: 0, sumidas: [] };
    grupo.total++;
    if (!vistasHoje.has(v.fonteId)) grupo.sumidas.push(v.id);
    porConsulta.set(k, grupo);
  }

  const encerrar: number[] = [];
  const suspeitas: string[] = [];
  for (const [k, g] of porConsulta) {
    if (g.sumidas.length >= minimo && g.sumidas.length / g.total > teto) {
      suspeitas.push(`${k}: sumiriam ${g.sumidas.length} de ${g.total}`);
      continue;
    }
    encerrar.push(...g.sumidas);
  }

  return { encerrar, reabrir, suspeitas };
}
