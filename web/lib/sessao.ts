/**
 * Memória de busca da sessão.
 *
 * A premissa nova (26/08) é: consulta nova sempre que o usuário trocar de cargo
 * ou de cidade, e busca repetida dentro da mesma sessão não repete a consulta.
 * Este módulo é a segunda metade dessa frase.
 *
 * Ele é a camada RASA de duas. A camada durável é `coletas_sob_demanda`, no
 * Postgres, que vale para todos os usuários — porque o custo escala com pares
 * cargo×cidade distintos, não com sessões. Este cookie só evita a ida ao banco
 * para descobrir o que a sessão já sabe: que esta pessoa acabou de ver
 * exatamente esta busca.
 *
 * Se as duas discordarem, quem manda é o banco. O cookie pode ser velho, pode
 * ter vindo de outro dispositivo, pode ter sido editado à mão — ele nunca
 * autoriza nada, só permite PULAR trabalho.
 */
import { cookies } from 'next/headers';

const NOME = 'wagas_busca';

/** Mesma janela do frescor no banco: o cookie não pode ser mais otimista que ele. */
const VALIDADE_MS = 30 * 60_000;

export interface BuscaDaSessao {
  chave: string;
  em: number;
}

export function chaveDaBusca(cargo: string, cidade: string, soRemoto: boolean): string {
  return `${cargo.trim().toLowerCase()}|${cidade.trim().toLowerCase()}|${soRemoto ? 'r' : 'c'}`;
}

/** A sessão já viu esta busca há pouco? */
export async function buscaRecenteNaSessao(chave: string, agora = Date.now()): Promise<boolean> {
  try {
    const bruto = (await cookies()).get(NOME)?.value;
    if (!bruto) return false;
    const salvo = JSON.parse(bruto) as BuscaDaSessao;
    return salvo.chave === chave && agora - salvo.em < VALIDADE_MS;
  } catch {
    // Cookie corrompido ou editado: trata como se não existisse.
    return false;
  }
}

/**
 * Anota a busca na sessão.
 *
 * Silencioso quando não dá para gravar: Server Components não escrevem cookie,
 * e este cookie é conveniência — perder a anotação custa uma consulta a mais ao
 * banco, não um erro na cara do usuário.
 */
export async function anotarBuscaNaSessao(chave: string, agora = Date.now()): Promise<void> {
  try {
    (await cookies()).set(NOME, JSON.stringify({ chave, em: agora } satisfies BuscaDaSessao), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: VALIDADE_MS / 1000,
    });
  } catch {
    // sem contexto de escrita; segue sem anotar
  }
}
