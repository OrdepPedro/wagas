/**
 * Teto de buscas.
 *
 * Visitante: 2 buscas salvas, cada uma valendo 7 dias — a mesma janela do feed.
 * Dentro do prazo ele volta e troca entre as duas sem gastar nada; passado o
 * prazo, a vaga libera. Com e-mail: 10 pares por dia (Brasília).
 *
 * Existe por dois motivos que puxam para o mesmo lado. O primeiro é o desenho
 * de tiers: o gratuito precisa ter um limite para o pago ter o que oferecer. O
 * segundo é operacional e mais urgente — cada busca de par novo dispara uma
 * varredura numa API pública de terceiro que não nos deve nada, e mais adiante
 * pode disparar coleta paga. Sem teto, uma aba recarregando em loop vira abuso.
 *
 * A contagem sai de `buscas`, que já existe e já é a fonte da métrica de
 * produto. Uma tabela de contador separada discordaria dela na primeira semana
 * — o mesmo raciocínio que fez `resultados` morar em `buscas` em vez de numa
 * tabela só para o feed vazio.
 *
 * O dia é o de Brasília, não UTC. Um limite diário que vira às 21h para o
 * usuário é um limite que parece quebrado.
 */
import { slugCidade } from '../../src/normalize/local.ts';
import { clienteDoServidor } from './supabase.ts';
import { ocuparVagas, type Vaga } from './pares-do-dia.ts';

export const LIMITE_VISITANTE = numero('LIMITE_VISITANTE', 2);
/** Quanto vale uma busca salva do visitante: a janela do feed. */
export const VALIDADE_VISITANTE_MS = 7 * 24 * 60 * 60 * 1000;
export const LIMITE_GRATUITO = numero('LIMITE_DIARIO_GRATUITO', 10);

function numero(nome: string, padrao: number): number {
  const bruto = process.env[nome]?.trim();
  if (!bruto) return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
}

/**
 * Meia-noite de Brasília do dia corrente, em ISO.
 *
 * O offset é fixo em -03:00 porque o Brasil não tem horário de verão desde
 * 2019, e é a mesma convenção que `dataDoSnippetGupy` já usa no coletor. Se o
 * horário de verão voltar, os dois lugares mudam juntos.
 */
export function inicioDoDiaBrasilia(agora = new Date()): string {
  const [dia] = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('T');
  return new Date(`${dia}T00:00:00-03:00`).toISOString();
}

export interface EstadoDoLimite {
  usadas: number;
  teto: number;
  restantes: number;
  estourou: boolean;
  visitante: boolean;
  /** Buscas salvas ativas, a atual incluída quando ocupou vaga. */
  vagas: Vaga[];
}

/**
 * Quanto do teto está ocupado, e se a busca atual cabe.
 *
 * Erro de leitura devolve "não estourou". Bloquear alguém por causa de uma
 * falha de rede na contagem é o pior dos dois erros possíveis aqui.
 */
export async function estadoDoLimite(
  userId: string,
  visitante: boolean,
  cargo: string,
  cidade: string,
): Promise<EstadoDoLimite> {
  const teto = visitante ? LIMITE_VISITANTE : LIMITE_GRATUITO;
  const agora = new Date();
  // Visitante olha para trás o dobro da validade: uma vaga aberta há 6 dias
  // ainda está ativa, e a simulação precisa ver a busca que a abriu.
  const desde = visitante
    ? new Date(agora.getTime() - 2 * VALIDADE_VISITANTE_MS).toISOString()
    : inicioDoDiaBrasilia(agora);

  try {
    const supabase = await clienteDoServidor();
    const { data, error } = await supabase
      .from('buscas')
      .select('cargo, cidade, cidade_slug, criado_em')
      .eq('user_id', userId)
      .gte('criado_em', desde);
    if (error) throw error;

    const { vagas, estourou } = ocuparVagas(
      data ?? [],
      { cargo, cidade, cidadeSlug: slugCidade(cidade) },
      teto,
      visitante ? VALIDADE_VISITANTE_MS : Infinity,
      agora,
    );
    return {
      usadas: vagas.length,
      teto,
      restantes: Math.max(teto - vagas.length, 0),
      estourou,
      visitante,
      vagas,
    };
  } catch {
    return { usadas: 0, teto, restantes: teto, estourou: false, visitante, vagas: [] };
  }
}
