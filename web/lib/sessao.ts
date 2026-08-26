/**
 * Memória de busca da sessão.
 *
 * Premissa do produto (26/08): consulta nova sempre que o usuário trocar de
 * cargo ou de cidade, e busca repetida dentro da mesma sessão não repete a
 * consulta.
 *
 * ONDE ESTA CAMADA PODE ESCREVER, e por que isso moldou o desenho: o Next só
 * permite gravar cookie em Server Action ou Route Handler. A primeira versão
 * deste módulo gravava durante a renderização do feed, num `try/catch` que
 * engolia o erro — ou seja, nunca gravou nada e fingia funcionar. Agora quem
 * grava é a AÇÃO de buscar, que é o momento em que a busca de fato acontece; o
 * feed só lê.
 *
 * E esta é a camada RASA. A garantia mora em `coletas_sob_demanda`, no Postgres,
 * que vale para todos os usuários e todos os dispositivos — porque o custo
 * escala com pares cargo×cidade distintos, não com sessões. O cookie só evita
 * ida ao banco quando a própria pessoa repete a busca que acabou de fazer.
 */
import { cookies } from 'next/headers';

const NOME = 'wagas_busca';

/** Mesma janela do frescor no banco: o cookie não pode ser mais otimista que ele. */
const VALIDADE_MS = 30 * 60_000;

export interface BuscaDaSessao {
  chave: string;
  /** A submissão que gravou este cookie repetiu a busca anterior da sessão? */
  repetida: boolean;
  em: number;
}

export function chaveDaBusca(cargo: string, cidade: string, soRemoto: boolean): string {
  return `${cargo.trim().toLowerCase()}|${cidade.trim().toLowerCase()}|${soRemoto ? 'r' : 'c'}`;
}

/** Lê o que a sessão guardou. Seguro em Server Component. */
export async function lerBuscaDaSessao(): Promise<BuscaDaSessao | null> {
  try {
    const bruto = (await cookies()).get(NOME)?.value;
    if (!bruto) return null;
    const salvo = JSON.parse(bruto) as BuscaDaSessao;
    if (typeof salvo.chave !== 'string' || typeof salvo.em !== 'number') return null;
    return salvo;
  } catch {
    // Cookie corrompido ou editado à mão: trata como inexistente. Ele nunca
    // autoriza nada — só permite pular trabalho.
    return null;
  }
}

/**
 * A sessão já fez esta MESMA busca antes desta submissão?
 *
 * Só é verdade quando a chave bate, o cookie está dentro da validade e a
 * submissão que o gravou foi ela própria uma repetição. Sem a terceira
 * condição, a primeira busca de um cargo novo seria tratada como repetida e
 * nunca coletaria nada.
 */
export function ehRepeticao(salvo: BuscaDaSessao | null, chave: string, agora = Date.now()): boolean {
  if (!salvo) return false;
  return salvo.chave === chave && salvo.repetida && agora - salvo.em < VALIDADE_MS;
}

/**
 * Anota a busca. SÓ pode ser chamada de Server Action ou Route Handler.
 *
 * `repetida` é calculado comparando com o que já estava na sessão: é isso que
 * distingue "primeira vez que peço este cargo" de "estou pedindo de novo".
 */
export async function gravarBuscaDaSessao(chave: string, agora = Date.now()): Promise<void> {
  const anterior = await lerBuscaDaSessao();
  const repetida = anterior?.chave === chave;

  (await cookies()).set(
    NOME,
    JSON.stringify({ chave, repetida, em: agora } satisfies BuscaDaSessao),
    { httpOnly: true, sameSite: 'lax', path: '/', maxAge: VALIDADE_MS / 1000 },
  );
}
