'use server';

import { createHash } from 'node:crypto';

import { LlmIndisponivel, ProvedorGemini } from '../../../../src/classificar/llm.ts';
import { CurriculoSemTexto, medirCurriculo } from '../../../../src/curriculo/medir.ts';
import type { Extracao, ResultadoDaMedicao } from '../../../../src/curriculo/tipos.ts';
import { log } from '../../../../src/logger.ts';
import { clienteAdministrativo } from '../../../lib/admin.ts';
import { ArquivoIlegivel, extrairArquivo } from '../../../lib/curriculo.ts';
import { inicioDoDiaBrasilia } from '../../../lib/limites.ts';
import { usuarioAtual } from '../../../lib/supabase.ts';

export interface EstadoDaMedicao {
  erro?: string;
  /** Mostra o campo de texto: o arquivo não deu para ler. */
  pedirTexto?: boolean;
  id?: string;
  resultado?: ResultadoDaMedicao;
}

/**
 * Teto diário de medições. Cada uma é uma chamada ao Gemini no tier gratuito,
 * que tem cota diária do projeto inteiro: sem teto, uma pessoa recarregando
 * esgota o medidor para todo mundo.
 */
const TETO_VISITANTE = numero('LIMITE_ATS_VISITANTE', 3);
const TETO_CONTA = numero('LIMITE_ATS_DIARIO', 10);

function numero(nome: string, padrao: number): number {
  const n = Number(process.env[nome]?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
}

const MIN_TEXTO = 300;

/** Só conta o que chegou ao LLM: arquivo recusado na extração não gastou cota. */
async function medicoesHoje(userId: string): Promise<number> {
  try {
    const linhas = await clienteAdministrativo().select<{ id: string }>(
      'medicoes_curriculo',
      `select=id&user_id=eq.${userId}&modelo=not.is.null&criado_em=gte.${encodeURIComponent(inicioDoDiaBrasilia())}`,
    );
    return linhas.length;
  } catch {
    // Mesmo critério do teto de buscas: falha na contagem não bloqueia ninguém.
    return 0;
  }
}

function hash(extracao: Extracao, cargo: string, vaga: string | null): string {
  return createHash('sha256')
    .update(`${extracao.texto}\n${cargo.toLowerCase()}\n${vaga ?? ''}`)
    .digest('hex');
}

async function registrar(linha: Record<string, unknown>): Promise<string | undefined> {
  try {
    const [gravada] = await clienteAdministrativo().insert<{ id: string }>('medicoes_curriculo', [linha], {
      retornar: true,
    });
    return gravada?.id;
  } catch (erro) {
    // O evento é a medição do produto, mas perder um não pode custar o
    // resultado que a pessoa esperou para ver.
    log.error('falha ao registrar medição de currículo', { erro: String(erro) });
    return undefined;
  }
}

export async function medir(_anterior: EstadoDaMedicao, form: FormData): Promise<EstadoDaMedicao> {
  const usuario = await usuarioAtual();
  if (!usuario) return { erro: 'Não encontramos sua sessão. Recarregue a página e tente de novo.' };

  const cargo = String(form.get('cargo') ?? '').trim().slice(0, 120);
  const vaga = String(form.get('vaga') ?? '').trim().slice(0, 20_000) || null;
  const colado = String(form.get('texto') ?? '').trim();
  const arquivo = form.get('arquivo');
  const temArquivo = arquivo instanceof File && arquivo.size > 0;

  if (cargo.length < 3) return { erro: 'Informe o cargo que você busca.' };
  if (!temArquivo && !colado) return { erro: 'Envie o currículo em PDF ou DOCX, ou cole o texto.' };

  const chave = process.env['GEMINI_KEY']?.trim();
  if (!chave) return { erro: 'O medidor está fora do ar agora. Tente mais tarde.' };

  const teto = usuario.visitante ? TETO_VISITANTE : TETO_CONTA;
  if ((await medicoesHoje(usuario.id)) >= teto) {
    return {
      erro: usuario.visitante
        ? `Você usou as ${teto} medições de hoje. Entre com seu e-mail para medir até ${TETO_CONTA} por dia.`
        : `Você usou as ${teto} medições de hoje. O limite volta à meia-noite.`,
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
    tipo_entrada: extracao.sinais.tipo,
    cargo,
    tinha_vaga: vaga !== null,
    paginas: extracao.sinais.paginas,
    caracteres: extracao.sinais.caracteres,
    sinais: extracao.sinais,
    hash_entrada: hash(extracao, cargo, vaga),
  };

  const inicio = Date.now();
  const provedor = new ProvedorGemini({
    chave,
    modelo: process.env['GEMINI_MODELO']?.trim() || 'gemini-3.5-flash-lite',
    intervaloMs: 0,
    tentativas: 2,
  });

  try {
    const resultado = await medirCurriculo({ extracao, cargo, vaga }, provedor);
    const id = await registrar({
      ...base,
      nota: resultado.nota,
      criterios: Object.fromEntries(resultado.criterios.map((c) => [c.id, c.avaliado ? c.pontos : null])),
      requisitos_total: resultado.requisitos.length,
      requisitos_demonstrados: resultado.requisitos.filter((r) => r.status === 'demonstrado').length,
      alertas_tipos: resultado.alertas.map((a) => a.tipo),
      modelo: resultado.modelo,
      duracao_ms: Date.now() - inicio,
    });
    return { resultado, ...(id ? { id } : {}) };
  } catch (erro) {
    if (erro instanceof CurriculoSemTexto) {
      await registrar({ ...base, erro: 'sem_texto' });
      return {
        erro: 'O arquivo quase não tem texto selecionável — provavelmente é imagem ou escaneado. Um ATS também não leria. Cole o texto abaixo para medir o conteúdo.',
        pedirTexto: true,
      };
    }
    await registrar({ ...base, modelo: provedor.nome, erro: String(erro).slice(0, 300), duracao_ms: Date.now() - inicio });
    log.error('falha na medição de currículo', { erro: String(erro) });
    if (erro instanceof LlmIndisponivel) return { erro: 'O medidor atingiu o limite de uso por agora. Tente de novo mais tarde.' };
    return { erro: 'A avaliação falhou. Tente de novo em instantes.' };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Isso foi útil?". Só a própria pessoa responde pela própria medição. */
export async function registrarFeedback(id: string, util: boolean): Promise<void> {
  const usuario = await usuarioAtual();
  if (!usuario || !UUID.test(id)) return;
  try {
    await clienteAdministrativo().update('medicoes_curriculo', `id=eq.${id}&user_id=eq.${usuario.id}`, {
      util,
      feedback_em: new Date().toISOString(),
    });
  } catch (erro) {
    log.error('falha ao registrar feedback do medidor', { erro: String(erro) });
  }
}
