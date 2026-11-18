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
import {
  fonteDaVerdade,
  interpretarCorrecao,
  lerEdicaoManual,
  montarPromptDeCorrecao,
  PROVEDOR_MANUAL,
  textoDoCurriculo,
} from '../../src/curriculo/corrigir.ts';
import { clienteAdministrativo } from './admin.ts';
import { ArquivoIlegivel, extrairArquivo } from './curriculo.ts';
import { inicioDoDiaBrasilia } from './limites.ts';
import { clienteDoServidor } from './supabase.ts';

export const LIMITE_ADAPTACOES = (() => {
  const n = Number(process.env['LIMITE_ADAPTACOES_DIARIO']?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
})();

/** gpt-oss-120b: produção no Groq em 03/11, com limite de taxa publicado. Conferir antes de confiar. */
const MODELO_PADRAO = 'openai/gpt-oss-120b';

/**
 * Ajustes pelo chat da revisão, por pessoa por dia. Cada um é uma chamada
 * inteira ao Groq (CV + versão atual), da mesma cota de ~1 chamada por minuto
 * que serve o produto todo — por isso o teto existe.
 */
export const LIMITE_CORRECOES = (() => {
  const n = Number(process.env['LIMITE_CORRECOES_DIARIO']?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
})();

/** Também usado pela comparação do Mapa: o CV salvo vai só para o Groq (consentimento de /curriculo). */
export function provedorDoCurriculo(chave: string): ProvedorGroq {
  return new ProvedorGroq({
    chave,
    modelo: process.env['GROQ_MODELO_CURRICULO']?.trim() || MODELO_PADRAO,
    tentativas: 2,
    // Medido em 03/11 com CV real de ~5 mil caracteres: prompt de 3.400 tokens,
    // e o padrão de saída (3.072) cortou o JSON no meio. Com raciocínio baixo,
    // 4.000 sobra para o currículo e cabe com o prompt nos 8.000/min do tier.
    maxTokens: 4_000,
    reasoningEffort: 'low',
  });
}

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
 *
 * O `resultado` é zerado pela chave de servidor: desde a 0019 a pessoa não
 * altera as próprias adaptações, senão zerava o teto diário pelo PostgREST.
 * O `userId` vem de `usuarioAtual()` (token validado no servidor), nunca do
 * formulário.
 */
export async function apagarCurriculo(userId: string): Promise<boolean> {
  const supabase = await clienteDoServidor();
  const { error: e1 } = await supabase.from('curriculos').delete().eq('user_id', userId);
  try {
    await clienteAdministrativo().update(
      'adaptacoes',
      `user_id=eq.${encodeURIComponent(userId)}&resultado=not.is.null`,
      { resultado: null },
    );
    // Pedido no chat pode citar dado do CV ("minha pós é de 2022"): vai junto.
    await clienteAdministrativo().update(
      'adaptacao_correcoes',
      `user_id=eq.${encodeURIComponent(userId)}&pedido=not.is.null`,
      { pedido: null, resposta: null, resultado: null },
    );
  } catch {
    return false;
  }
  // A comparação do Mapa guarda o trecho do CV que prova cada requisito (0024).
  // Sem a 0024 aplicada a tabela não existe e não há o que apagar: esse erro
  // não pode impedir a pessoa de apagar o currículo.
  try {
    await clienteAdministrativo().update(
      'mapa_comparacoes',
      `user_id=eq.${encodeURIComponent(userId)}&resultado=not.is.null`,
      { resultado: null },
    );
  } catch (erro) {
    // Só "tabela não existe" (PGRST205 / 42P01) passa; a mensagem traz o
    // caminho com o nome da tabela, então casar o nome aceitaria qualquer erro.
    if (!/PGRST205|42P01/.test(String(erro))) return false;
  }
  return !e1;
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
  conversa: Mensagem[];
  /** 0 = a adaptação original; senão, o id da correção que gerou a versão atual. */
  versao: number;
  /** A pessoa confirmou ESTA versão. Só então o PDF sai. */
  confirmada: boolean;
  /** O que a pessoa afirmou (pedidos do chat e textos editados à mão): soma à fonte da verdade. */
  fatos: string[];
}

/**
 * Uma entrada da conversa de revisão: um pedido à IA, ou uma edição manual.
 * Só as que deram certo: a falha aparece na hora, como erro do formulário.
 */
export interface Mensagem {
  /** Vazio na edição manual. */
  pedido: string;
  resposta: string;
  /** A IA mudou o currículo nesta troca? Recusar inventar, por exemplo, não muda. */
  mudou: boolean;
  /** A pessoa editou o currículo à mão (não foi a IA). */
  manual: boolean;
}

interface LinhaDaAdaptacao {
  id: number;
  resultado: unknown;
  criado_em: string;
  vaga_cargo?: string | null;
  vaga_empresa?: string | null;
  // Colunas da 0022. Lidas por `*` e tratadas como opcionais: sem a migration,
  // a adaptação continua sendo achada (e não é refeita, gastando cota).
  confirmada_versao?: number | null;
  confirmado_em?: string | null;
}

interface LinhaDaCorrecao {
  id: number;
  pedido: string | null;
  resposta: string | null;
  resultado: unknown;
  provedor: string | null;
}

/** As correções que deram certo, em ordem. Tabela ausente (sem a 0022) = conversa vazia. */
async function lerCorrecoes(adaptacaoId: number): Promise<LinhaDaCorrecao[]> {
  try {
    const supabase = await clienteDoServidor();
    const { data, error } = await supabase
      .from('adaptacao_correcoes')
      .select('id, pedido, resposta, resultado, provedor')
      .eq('adaptacao_id', adaptacaoId)
      .eq('ok', true)
      .order('id', { ascending: true });
    if (error) return [];
    return (data ?? []) as LinhaDaCorrecao[];
  } catch {
    return [];
  }
}

/**
 * Versão atual, conversa e confirmação. Nome corrigido e fidelidade conferida
 * na leitura também, não só na gravação: é barato, e adaptação gravada antes
 * de uma regra nova sai certa sem gastar outra chamada.
 */
async function montarAdaptacao(curriculo: Curriculo, linha: LinhaDaAdaptacao): Promise<Adaptacao> {
  let atual = linha.resultado as CurriculoAdaptado;
  let versao = 0;
  const conversa: Mensagem[] = [];
  const fatos: string[] = [];
  for (const c of await lerCorrecoes(linha.id)) {
    if (c.pedido === null) continue; // apagada junto com o CV
    const manual = c.provedor === PROVEDOR_MANUAL;
    if (c.resultado) {
      atual = c.resultado as CurriculoAdaptado;
      versao = c.id;
    }
    conversa.push({ pedido: c.pedido, resposta: c.resposta ?? '', mudou: Boolean(c.resultado), manual });
    fatos.push(manual && c.resultado ? textoDoCurriculo(c.resultado as CurriculoAdaptado) : c.pedido);
  }

  // O que a pessoa afirmou no chat ou escreveu à mão conta como fonte (src/curriculo/corrigir.ts).
  const fonte = fonteDaVerdade(curriculo.texto, fatos);
  const { adaptado: resultado, corrigidos } = corrigirNomes(fonte, atual);
  return {
    id: linha.id,
    resultado,
    alertas: verificarFidelidade(fonte, resultado),
    corrigidos,
    criadoEm: linha.criado_em,
    conversa,
    versao,
    confirmada: Boolean(linha.confirmado_em) && Number(linha.confirmada_versao ?? -1) === versao,
    fatos,
  };
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
    .select('*')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .eq('curriculo_hash', curriculo.hash)
    .eq('ok', true)
    .not('resultado', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return montarAdaptacao(curriculo, data as LinhaDaAdaptacao);
}

/** Adaptações bem-sucedidas hoje (Brasília). Erro de leitura não bloqueia ninguém. */
export async function adaptacoesHoje(userId: string): Promise<number> {
  return contarHoje('adaptacoes', userId);
}

/** Ajustes pela IA que deram certo hoje (Brasília). A edição manual não gasta IA e não conta. */
export async function correcoesHoje(userId: string): Promise<number> {
  return contarHoje('adaptacao_correcoes', userId);
}

async function contarHoje(tabela: 'adaptacoes' | 'adaptacao_correcoes', userId: string): Promise<number> {
  try {
    const supabase = await clienteDoServidor();
    let consulta = supabase
      .from(tabela)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ok', true)
      .gte('criado_em', inicioDoDiaBrasilia());
    if (tabela === 'adaptacao_correcoes') consulta = consulta.neq('provedor', PROVEDOR_MANUAL);
    const { count, error } = await consulta;
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Adaptação de vaga colada (extensão), pelo id. A linha precisa ser deste
 * usuário (RLS) e deste CV: trocou o CV, a adaptação antiga não vale mais.
 */
export async function lerAdaptacaoColada(
  userId: string,
  curriculo: Curriculo,
  filtro: { id: number } | { vagaHash: string },
): Promise<(Adaptacao & { cargo: string; empresa: string }) | null> {
  const supabase = await clienteDoServidor();
  let consulta = supabase
    .from('adaptacoes')
    .select('*')
    .eq('user_id', userId)
    .eq('origem', 'colada')
    .eq('curriculo_hash', curriculo.hash)
    .eq('ok', true)
    .not('resultado', 'is', null);
  consulta = 'id' in filtro ? consulta.eq('id', filtro.id) : consulta.eq('vaga_hash', filtro.vagaHash);
  const { data } = await consulta.order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const linha = data as LinhaDaAdaptacao;
  return { ...(await montarAdaptacao(curriculo, linha)), cargo: linha.vaga_cargo ?? '', empresa: linha.vaga_empresa ?? '' };
}

export type FalhaDaAdaptacao = 'indisponivel' | 'cota' | 'resposta';

/** Vaga do feed, ou vaga colada na extensão (sem `job_id`; o texto não é gravado). */
export type AlvoDaAdaptacao = { jobId: number } | { colada: { cargo: string; empresa: string; hash: string } };

/**
 * Chama o modelo e grava a tentativa — com sucesso ou não.
 *
 * Só roda dentro de Server Action ou Route Handler, nunca no render: é escrita
 * no banco e custo de cota, e render repete (achado 25).
 */
export async function adaptar(
  userId: string,
  alvo: AlvoDaAdaptacao,
  curriculo: Curriculo,
  vaga: VagaParaAdaptar,
): Promise<{ ok: true; id: number | null } | { ok: false; falha: FalhaDaAdaptacao }> {
  const chave = process.env['GROQ_KEY']?.trim();
  if (!chave) return { ok: false, falha: 'indisponivel' };

  const provedor = provedorDoCurriculo(chave);
  const supabase = await clienteDoServidor();
  const inicio = Date.now();
  const base = {
    user_id: userId,
    curriculo_hash: curriculo.hash,
    provedor: provedor.nome,
    // Vaga do feed não manda `origem` (o default da 0018 é 'feed'): assim a
    // adaptação do feed continua funcionando num banco ainda sem a 0018.
    ...('jobId' in alvo
      ? { job_id: alvo.jobId }
      : {
          job_id: null,
          origem: 'colada',
          vaga_cargo: alvo.colada.cargo,
          vaga_empresa: alvo.colada.empresa,
          vaga_hash: alvo.colada.hash,
        }),
  };

  try {
    const bruto = await provedor.julgar(montarPrompt(curriculo.texto, vaga), null);
    // O modelo copia nome próprio com letra trocada (03/11: 3 de 4 empresas).
    // O nome que vai para o PDF é o do CV, não o dele.
    const { adaptado: resultado } = corrigirNomes(curriculo.texto, interpretarResposta(bruto));
    const alertas = verificarFidelidade(curriculo.texto, resultado);
    const { data } = await supabase
      .from('adaptacoes')
      .insert({
        ...base,
        ok: true,
        resultado,
        alertas: alertas.length,
        duracao_ms: Date.now() - inicio,
      })
      .select('id')
      .maybeSingle();
    return { ok: true, id: data?.id ?? null };
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

/**
 * Um pedido do chat de revisão: chama o modelo com o CV original, a versão
 * atual e o pedido, e grava a troca — com sucesso ou não, como a adaptação.
 *
 * Só em Server Action ou Route Handler (escrita e cota; render repete).
 */
export async function corrigir(
  userId: string,
  adaptacao: Adaptacao,
  curriculo: Curriculo,
  vaga: { cargo: string; empresa: string },
  pedido: string,
): Promise<{ ok: true } | { ok: false; falha: FalhaDaAdaptacao }> {
  const chave = process.env['GROQ_KEY']?.trim();
  if (!chave) return { ok: false, falha: 'indisponivel' };

  const provedor = provedorDoCurriculo(chave);
  const supabase = await clienteDoServidor();
  const inicio = Date.now();
  const base = { adaptacao_id: adaptacao.id, user_id: userId, pedido: pedido.trim(), provedor: provedor.nome };

  try {
    // A edição manual não entra como troca: o efeito dela já está na versão atual.
    const historico = adaptacao.conversa
      .filter((m) => !m.manual)
      .map(({ pedido: p, resposta }) => ({ pedido: p, resposta }));
    const bruto = await provedor.julgar(
      montarPromptDeCorrecao(curriculo.texto, adaptacao.resultado, vaga, historico, pedido),
      null,
    );
    const { resposta, curriculo: novo } = interpretarCorrecao(bruto, adaptacao.resultado);
    const fonte = fonteDaVerdade(curriculo.texto, [...adaptacao.fatos, pedido]);
    const resultado = novo ? corrigirNomes(fonte, novo).adaptado : null;
    const { error } = await supabase.from('adaptacao_correcoes').insert({
      ...base,
      ok: true,
      resposta,
      resultado,
      alertas: resultado ? verificarFidelidade(fonte, resultado).length : null,
      duracao_ms: Date.now() - inicio,
    });
    return error ? { ok: false, falha: 'resposta' } : { ok: true };
  } catch (erro) {
    await supabase.from('adaptacao_correcoes').insert({
      ...base,
      ok: false,
      duracao_ms: Date.now() - inicio,
      erro: String(erro instanceof Error ? erro.message : erro).slice(0, 300),
    });
    return { ok: false, falha: erro instanceof LlmIndisponivel ? 'cota' : 'resposta' };
  }
}

/**
 * "Revisei, pode gerar o PDF" — para a versão que a pessoa estava vendo.
 *
 * Pela chave de servidor, porque a pessoa não altera `adaptacoes` (0019/0020).
 * O `userId` vem do token validado e vai no filtro: só confirma adaptação
 * própria. Se um ajuste entrou entre a tela e o clique, `versao` já não é a
 * atual e a confirmação não vale para a versão nova.
 */
export async function confirmar(userId: string, adaptacaoId: number, versao: number): Promise<boolean> {
  try {
    await clienteAdministrativo().update(
      'adaptacoes',
      `id=eq.${adaptacaoId}&user_id=eq.${encodeURIComponent(userId)}`,
      { confirmado_em: new Date().toISOString(), confirmada_versao: versao },
    );
    return true;
  } catch {
    return false;
  }
}

export const MENSAGEM_DA_FALHA: Record<FalhaDaAdaptacao, string> = {
  indisponivel: 'A adaptação está desligada neste ambiente.',
  cota: 'O serviço de IA está no limite agora. Tente de novo em alguns minutos.',
  resposta: 'A IA devolveu uma resposta que não consegui usar. Tente de novo.',
};

/**
 * Grava o currículo que a pessoa editou à mão como a versão nova. Sem IA e sem
 * teto diário. Devolve o erro em linguagem de tela quando a edição não serve.
 */
export async function salvarEdicao(userId: string, adaptacao: Adaptacao, editado: unknown): Promise<{ ok: true } | { erro: string }> {
  const lido = lerEdicaoManual(editado, adaptacao.resultado);
  if ('erro' in lido) return lido;
  const supabase = await clienteDoServidor();
  const { error } = await supabase.from('adaptacao_correcoes').insert({
    adaptacao_id: adaptacao.id,
    user_id: userId,
    // Vazio, não null: null é a marca de "apagado junto com o CV".
    pedido: '',
    resposta: '',
    resultado: lido.curriculo,
    ok: true,
    alertas: 0,
    provedor: PROVEDOR_MANUAL,
  });
  return error ? { erro: 'Não consegui salvar a edição. Tente de novo.' } : { ok: true };
}
