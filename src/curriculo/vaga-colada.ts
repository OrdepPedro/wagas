/**
 * Vaga colada pela pessoa (extensão do Chrome), em vez de vaga do feed.
 *
 * A extensão NÃO lê a página que a pessoa está vendo — decisão do Pedro em
 * 06/11, e a restrição 2 do CLAUDE.md proíbe ler o DOM logado do LinkedIn de
 * qualquer jeito. A pessoa cola cargo e descrição; o CV já está salvo.
 *
 * Esta é a primeira adaptação para vaga que NÃO veio do feed. A coluna
 * `adaptacoes.origem` separa as duas, e é a medida do risco do cabeçalho do
 * CLAUDE.md: se a maioria das adaptações vier de fora do feed, o encaixe vaga +
 * CV não está segurando ninguém e o produto é o wrapper de LLM.
 */
import { createHash } from 'node:crypto';
import { DESCRICAO_MINIMA, type VagaParaAdaptar } from './adaptar.ts';

export const CARGO_MAXIMO = 150;
export const EMPRESA_MAXIMA = 150;
/** Acima disso é colagem da página inteira. O prompt corta em 8.000 de qualquer jeito. */
export const DESCRICAO_COLADA_MAXIMA = 20_000;

export interface VagaColada {
  vaga: VagaParaAdaptar;
  /** Mesma vaga colada duas vezes com o mesmo CV não gasta cota de novo. */
  hash: string;
}

function linha(texto: unknown): string {
  return String(texto ?? '').replace(/\s+/g, ' ').trim();
}

function corpo(texto: unknown): string {
  return String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Valida o que a pessoa colou. `{ erro }` vem em linguagem de tela. */
export function lerVagaColada(entrada: unknown): VagaColada | { erro: string } {
  const e = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const cargo = linha(e['cargo']);
  const empresa = linha(e['empresa']);
  const descricao = corpo(e['descricao']);

  if (cargo === '') return { erro: 'Escreva o cargo da vaga.' };
  if (cargo.length > CARGO_MAXIMO) return { erro: 'O cargo ficou longo demais. Escreva só o título da vaga.' };
  if (empresa.length > EMPRESA_MAXIMA) return { erro: 'O nome da empresa ficou longo demais.' };
  if (descricao.length < DESCRICAO_MINIMA) {
    return {
      erro: `Cole a descrição completa da vaga (atividades e requisitos). Com menos de ${DESCRICAO_MINIMA} caracteres não há o que adaptar.`,
    };
  }
  if (descricao.length > DESCRICAO_COLADA_MAXIMA) {
    return { erro: 'O texto colado é longo demais. Cole só a descrição da vaga, não a página inteira.' };
  }

  const hash = createHash('sha256')
    .update([cargo.toLowerCase(), empresa.toLowerCase(), descricao].join('\n'))
    .digest('hex')
    .slice(0, 32);
  return { vaga: { cargo, empresa: empresa || 'não informada', descricao, fonte: 'colada' }, hash };
}

/** Cabeçalho que só a extensão manda. Site de terceiro precisaria de preflight, que é recusado. */
export const CABECALHO_EXTENSAO = 'x-wagas-extensao';

/**
 * Mandado pelo painel que tem a etapa de revisão (extensão 0.2.0+).
 *
 * A 0.1.0 publicada baixa o PDF logo depois de adaptar e não tem botão de
 * confirmar. Se a rota de PDF exigisse confirmação de todo mundo, o download
 * dela quebraria entre o deploy do site e a atualização pela loja — e o Chrome
 * atualiza cada instalação num momento diferente. Então a confirmação só é
 * exigida de quem manda este cabeçalho. Quando a 0.1.0 sumir, a exceção sai.
 */
export const CABECALHO_REVISAO = 'x-wagas-revisao';

/** O PDF da extensão exige a versão confirmada? Só para o painel que sabe confirmar. */
export function exigeConfirmacao(cabecalhoRevisao: string | null): boolean {
  return cabecalhoRevisao !== null && cabecalhoRevisao.trim() !== '';
}

/**
 * Quem pode chamar a API da extensão com o cookie da pessoa.
 *
 * O cookie de sessão é `SameSite=Lax`, então site de terceiro já não o manda
 * em `fetch`. Por cima disso, duas trancas:
 *
 *   1. o cabeçalho `x-wagas-extensao`, obrigatório. Cabeçalho próprio força
 *      preflight em pedido de outra origem, e o preflight só passa para a
 *      extensão ou o site (`origemPermitida`);
 *   2. se veio `Origin`, ela tem de ser a extensão (pelo id, quando
 *      `EXTENSAO_ID` está definido) ou o próprio site.
 *
 * `Origin` ausente não basta para recusar: medido em 06/11, o Chrome NÃO manda
 * `Origin` no GET da extensão para host que está em `host_permissions`.
 */
export function chamadaPermitida(
  origem: string | null,
  cabecalhoExtensao: string | null,
  site: string,
  extensaoId?: string,
): boolean {
  if (cabecalhoExtensao !== '1') return false;
  return origem === null || origemPermitida(origem, site, extensaoId);
}

/** Origem conhecida: o próprio site ou a extensão. Sem `Origin`, falso. */
export function origemPermitida(origem: string | null, site: string, extensaoId?: string): boolean {
  if (!origem) return false;
  try {
    if (origem === new URL(site).origin) return true;
  } catch {
    // site mal configurado: segue só com a regra da extensão
  }
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(origem);
  if (!m) return false;
  return extensaoId ? m[1] === extensaoId : true;
}
