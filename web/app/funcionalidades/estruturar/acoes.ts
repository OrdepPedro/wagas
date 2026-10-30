'use server';

import { createHash } from 'node:crypto';

import { LlmIndisponivel, ProvedorGemini } from '../../../../src/classificar/llm.ts';
import { CurriculoSemTexto } from '../../../../src/curriculo/medir.ts';
import { estruturarCurriculo, PLATAFORMAS, type Estrutura, type Plataforma } from '../../../../src/curriculo/plataformas.ts';
import type { Extracao } from '../../../../src/curriculo/tipos.ts';
import { log } from '../../../../src/logger.ts';
import { clienteAdministrativo } from '../../../lib/admin.ts';
import { ArquivoIlegivel, extrairArquivo } from '../../../lib/curriculo.ts';
import { inicioDoDiaBrasilia } from '../../../lib/limites.ts';
import { usuarioAtual } from '../../../lib/supabase.ts';

export interface EstadoDaEstruturacao {
  erro?: string;
  /** Mostra o campo de texto: o arquivo não deu para ler. */
  pedirTexto?: boolean;
  id?: string;
  resultado?: Estrutura;
}

/**
 * Teto diário separado do medidor, mas pela mesma razão: cada geração é uma
 * chamada ao Gemini no tier gratuito, e a cota é do projeto inteiro.
 */
const TETO_VISITANTE = numero('LIMITE_ESTRUTURAR_VISITANTE', 3);
const TETO_CONTA = numero('LIMITE_ESTRUTURAR_DIARIO', 10);

function numero(nome: string, padrao: number): number {
  const n = Number(process.env[nome]?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
}

const MIN_TEXTO = 300;

/** Só conta o que chegou ao LLM: arquivo recusado na extração não gastou cota. */
async function geracoesHoje(userId: string): Promise<number> {
  try {
    const linhas = await clienteAdministrativo().select<{ id: string }>(
      'estruturacoes_curriculo',
      `select=id&user_id=eq.${userId}&modelo=not.is.null&criado_em=gte.${encodeURIComponent(inicioDoDiaBrasilia())}`,
    );
    return linhas.length;
  } catch {
    // Mesmo critério do medidor: falha na contagem não bloqueia ninguém.
    return 0;
  }
}

function hash(extracao: Extracao, plataforma: Plataforma, cargo: string, vaga: string | null): string {
  return createHash('sha256')
    .update(`${extracao.texto}\n${plataforma}\n${cargo.toLowerCase()}\n${vaga ?? ''}`)
    .digest('hex');
}

async function registrar(linha: Record<string, unknown>): Promise<string | undefined> {
  try {
    const [gravada] = await clienteAdministrativo().insert<{ id: string }>('estruturacoes_curriculo', [linha], {
      retornar: true,
    });
    return gravada?.id;
  } catch (erro) {
    log.error('falha ao registrar estruturação de currículo', { erro: String(erro) });
    return undefined;
  }
}

export async function estruturar(_anterior: EstadoDaEstruturacao, form: FormData): Promise<EstadoDaEstruturacao> {
  const usuario = await usuarioAtual();
  if (!usuario) return { erro: 'Não encontramos sua sessão. Recarregue a página e tente de novo.' };

  const plataforma = String(form.get('plataforma') ?? '') as Plataforma;
  const cargo = String(form.get('cargo') ?? '').trim().slice(0, 120);
  const vaga = String(form.get('vaga') ?? '').trim().slice(0, 20_000) || null;
  const colado = String(form.get('texto') ?? '').trim();
  const arquivo = form.get('arquivo');
  const temArquivo = arquivo instanceof File && arquivo.size > 0;

  if (!PLATAFORMAS.includes(plataforma)) return { erro: 'Escolha LinkedIn ou Gupy.' };
  if (cargo.length < 3) return { erro: 'Informe o cargo que você busca.' };
  if (!temArquivo && !colado) return { erro: 'Envie o currículo em PDF ou DOCX, ou cole o texto.' };

  const chave = process.env['GEMINI_KEY']?.trim();
  if (!chave) return { erro: 'O estruturador está fora do ar agora. Tente mais tarde.' };

  const teto = usuario.visitante ? TETO_VISITANTE : TETO_CONTA;
  if ((await geracoesHoje(usuario.id)) >= teto) {
    return {
      erro: usuario.visitante
        ? `Você usou as ${teto} gerações de hoje. Entre com seu e-mail para gerar até ${TETO_CONTA} por dia.`
        : `Você usou as ${teto} gerações de hoje. O limite volta à meia-noite.`,
    };
  }

  let extracao: Extracao;
  if (colado) {
    if (colado.length < MIN_TEXTO) return { erro: 'O texto colado está curto demais para ser um currículo.', pedirTexto: true };
    extracao = {
      texto: colado.slice(0, 30_000),
      sinais: {
        tipo: 'texto',
        paginas: null,
        caracteres: colado.length,
        semTexto: false,
        colunas: false,
        tabelas: 0,
        caixasDeTexto: 0,
        imagens: 0,
        contatoSoNoCabecalho: false,
      },
    };
  } else {
    try {
      extracao = await extrairArquivo(arquivo as File);
    } catch (erro) {
      if (erro instanceof ArquivoIlegivel) {
        return { erro: `Não consegui ler o arquivo: ${erro.message}. Cole o texto do currículo abaixo.`, pedirTexto: true };
      }
      throw erro;
    }
  }

  const base = {
    user_id: usuario.id,
    plataforma,
    tipo_entrada: extracao.sinais.tipo,
    cargo,
    tinha_vaga: vaga !== null,
    caracteres: extracao.sinais.caracteres,
    hash_entrada: hash(extracao, plataforma, cargo, vaga),
  };

  const inicio = Date.now();
  const provedor = new ProvedorGemini({
    chave,
    modelo: process.env['GEMINI_MODELO']?.trim() || 'gemini-3.5-flash-lite',
    intervaloMs: 0,
    tentativas: 2,
  });

  try {
    const resultado = await estruturarCurriculo({ extracao, plataforma, cargo, vaga }, provedor);
    const id = await registrar({
      ...base,
      experiencias: resultado.experiencias.length,
      itens: resultado.plataforma === 'gupy' ? resultado.habilidades.length : resultado.competencias.length,
      pendencias: resultado.pendencias.length,
      modelo: resultado.modelo,
      duracao_ms: Date.now() - inicio,
    });
    return { resultado, ...(id ? { id } : {}) };
  } catch (erro) {
    if (erro instanceof CurriculoSemTexto) {
      await registrar({ ...base, erro: 'sem_texto' });
      return {
        erro: 'O arquivo quase não tem texto selecionável — provavelmente é imagem ou escaneado. Cole o texto abaixo.',
        pedirTexto: true,
      };
    }
    await registrar({ ...base, modelo: provedor.nome, erro: String(erro).slice(0, 300), duracao_ms: Date.now() - inicio });
    log.error('falha na estruturação de currículo', { erro: String(erro) });
    if (erro instanceof LlmIndisponivel) return { erro: 'O estruturador atingiu o limite de uso por agora. Tente de novo mais tarde.' };
    return { erro: 'A geração falhou. Tente de novo em instantes.' };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Isso foi útil?". Só a própria pessoa responde pela própria geração. */
export async function registrarFeedback(id: string, util: boolean): Promise<void> {
  const usuario = await usuarioAtual();
  if (!usuario || !UUID.test(id)) return;
  try {
    await clienteAdministrativo().update('estruturacoes_curriculo', `id=eq.${id}&user_id=eq.${usuario.id}`, {
      util,
      feedback_em: new Date().toISOString(),
    });
  } catch (erro) {
    log.error('falha ao registrar feedback do estruturador', { erro: String(erro) });
  }
}
