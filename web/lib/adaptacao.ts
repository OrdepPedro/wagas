/**
 * Currículo do usuário e adaptações, do lado do servidor.
 *
 * Tudo aqui passa pela RLS com a sessão do usuário (chave pública), nunca pela
 * chave secreta: o CV é a coisa mais pessoal que o produto guarda, e a policy
 * `curriculos_dono` é o que garante que só o dono o lê.
 *
 * O provedor é o Groq, e só ele (decisão de 03/11). Não há cadeia com o Gemini
 * aqui de propósito: cair para o Gemini gratuito quando o Groq estourar a cota
 * mandaria CV para um tier cujos termos permitem uso do conteúdo. Sem Groq, a
 * adaptação fica indisponível — e a tela diz isso.
 */
import { ProvedorGroq, LlmIndisponivel } from '../../src/classificar/llm.ts';
import {
  hashDoCurriculo,
  interpretarResposta,
  montarPrompt,
  normalizarCurriculo,
  verificarFidelidade,
  corrigirNomes,
  type Alerta,
  type CurriculoAdaptado,
  type VagaParaAdaptar,
} from '../../src/curriculo/adaptar.ts';
import { ArquivoIlegivel, extrairArquivo } from './curriculo.ts';
import { inicioDoDiaBrasilia } from './limites.ts';
import { clienteDoServidor } from './supabase.ts';

export const LIMITE_ADAPTACOES = (() => {
  const n = Number(process.env['LIMITE_ADAPTACOES_DIARIO']?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
})();

/** gpt-oss-120b: produção no Groq em 03/11, com limite de taxa publicado. Conferir antes de confiar. */
const MODELO_PADRAO = 'openai/gpt-oss-120b';

export function adaptacaoDisponivel(): boolean {
  return Boolean(process.env['GROQ_KEY']?.trim());
}

export interface Curriculo {
  texto: string;
  origem: 'pdf' | 'texto';
  atualizadoEm: string;
  hash: string;
}

export async function lerCurriculo(userId: string): Promise<Curriculo | null> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase
    .from('curriculos')
    .select('texto, origem, atualizado_em')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return {
    texto: data.texto,
    origem: data.origem,
    atualizadoEm: data.atualizado_em,
    hash: hashDoCurriculo(data.texto),
  };
}

export async function salvarCurriculo(userId: string, texto: string, origem: 'pdf' | 'texto'): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const agora = new Date().toISOString();
  const { error } = await supabase.from('curriculos').upsert({
    user_id: userId,
    texto: normalizarCurriculo(texto),
    origem,
    // O consentimento é renovado a cada gravação: quem salva marcou a caixa
    // agora, com o texto que está mandando agora.
    consentido_em: agora,
    atualizado_em: agora,
  });
  return !error;
}

/**
 * "Apagar meu currículo": o CV e o conteúdo de todas as adaptações.
 * A linha da adaptação fica sem `resultado` — sobra a contagem, que é métrica.
 */
export async function apagarCurriculo(userId: string): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error: e1 } = await supabase.from('curriculos').delete().eq('user_id', userId);
  const { error: e2 } = await supabase
    .from('adaptacoes')
    .update({ resultado: null })
    .eq('user_id', userId)
    .not('resultado', 'is', null);
  return !e1 && !e2;
}

/**
 * Texto do arquivo enviado, pelo MESMO leitor do medidor (`lib/curriculo.ts`):
 * PDF pelo pdf.js, com detecção de coluna, e DOCX sem dependência. Dois
 * leitores de currículo no mesmo produto dariam dois textos diferentes para o
 * mesmo arquivo.
 *
 * `{ erro }` em linguagem de tela quando o arquivo não serve; texto vazio é
 * PDF escaneado, e a tela pede para colar.
 */
export async function textoDoArquivo(arquivo: File): Promise<{ texto: string } | { erro: string }> {
  try {
    const { texto } = await extrairArquivo(arquivo);
    const limpo = normalizarCurriculo(texto);
    if (limpo === '') {
      return { erro: 'Não consegui ler texto nesse arquivo — ele provavelmente é uma imagem escaneada. Cole o texto do currículo na caixa.' };
    }
    return { texto: limpo };
  } catch (erro) {
    if (erro instanceof ArquivoIlegivel) return { erro: `Não consegui ler o arquivo: ${erro.message}.` };
    return { erro: 'Não consegui ler o arquivo. Tente de novo ou cole o texto.' };
  }
}

export interface Adaptacao {
  id: number;
  resultado: CurriculoAdaptado;
  alertas: Alerta[];
  /** Empresas e cargos que o modelo copiou com erro e voltaram à grafia do CV. */
  corrigidos: number;
  criadoEm: string;
}

/** A adaptação já feita para esta vaga com ESTE currículo, se houver. */
export async function lerAdaptacao(
  userId: string,
  jobId: number,
  curriculo: Curriculo,
): Promise<Adaptacao | null> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase
    .from('adaptacoes')
    .select('id, resultado, criado_em')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .eq('curriculo_hash', curriculo.hash)
    .eq('ok', true)
    .not('resultado', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  // Corrigido e conferido na leitura também, não só na gravação: é barato, e
  // adaptação gravada antes de uma regra nova sai certa sem gastar outra chamada.
  const { adaptado: resultado, corrigidos } = corrigirNomes(curriculo.texto, data.resultado as CurriculoAdaptado);
  return {
    id: data.id,
    resultado,
    alertas: verificarFidelidade(curriculo.texto, resultado),
    corrigidos,
    criadoEm: data.criado_em,
  };
}

/** Adaptações bem-sucedidas hoje (Brasília). Erro de leitura não bloqueia ninguém. */
export async function adaptacoesHoje(userId: string): Promise<number> {
  try {
    const supabase = await clienteDoServidor();
    const { count, error } = await supabase
      .from('adaptacoes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ok', true)
      .gte('criado_em', inicioDoDiaBrasilia());
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export type FalhaDaAdaptacao = 'indisponivel' | 'cota' | 'resposta';

/**
 * Chama o modelo e grava a tentativa — com sucesso ou não.
 *
 * Só roda dentro de Server Action, nunca no render: é escrita no banco e custo
 * de cota, e render repete (achado 25).
 */
export async function adaptar(
  userId: string,
  jobId: number,
  curriculo: Curriculo,
  vaga: VagaParaAdaptar,
): Promise<{ ok: true } | { ok: false; falha: FalhaDaAdaptacao }> {
  const chave = process.env['GROQ_KEY']?.trim();
  if (!chave) return { ok: false, falha: 'indisponivel' };

  const provedor = new ProvedorGroq({
    chave,
    modelo: process.env['GROQ_MODELO_CURRICULO']?.trim() || MODELO_PADRAO,
    tentativas: 2,
    // Medido em 03/11 com CV real de ~5 mil caracteres: prompt de 3.400 tokens,
    // e o padrão de saída (3.072) cortou o JSON no meio. Com raciocínio baixo,
    // 4.000 sobra para o currículo e cabe com o prompt nos 8.000/min do tier.
    maxTokens: 4_000,
    reasoningEffort: 'low',
  });
  const supabase = await clienteDoServidor();
  const inicio = Date.now();
  const base = { user_id: userId, job_id: jobId, curriculo_hash: curriculo.hash, provedor: provedor.nome };

  try {
    const bruto = await provedor.julgar(montarPrompt(curriculo.texto, vaga), null);
    // O modelo copia nome próprio com letra trocada (03/11: 3 de 4 empresas).
    // O nome que vai para o PDF é o do CV, não o dele.
    const { adaptado: resultado } = corrigirNomes(curriculo.texto, interpretarResposta(bruto));
    const alertas = verificarFidelidade(curriculo.texto, resultado);
    await supabase.from('adaptacoes').insert({
      ...base,
      ok: true,
      resultado,
      alertas: alertas.length,
      duracao_ms: Date.now() - inicio,
    });
    return { ok: true };
  } catch (erro) {
    await supabase.from('adaptacoes').insert({
      ...base,
      ok: false,
      duracao_ms: Date.now() - inicio,
      // A mensagem do provedor, nunca o CV: é o que vai para a coluna.
      erro: String(erro instanceof Error ? erro.message : erro).slice(0, 300),
    });
    return { ok: false, falha: erro instanceof LlmIndisponivel ? 'cota' : 'resposta' };
  }
}
