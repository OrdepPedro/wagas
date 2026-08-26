/**
 * Leitura e escrita do classificador no Postgres.
 *
 * Separado de `classificador.ts` de propósito: a decisão precisa rodar sem
 * banco para o harness poder avaliar exatamente o mesmo código que produção
 * roda. Aqui fica só o que fala PostgREST.
 */
import { log } from '../logger.ts';
import type { SupabaseRest } from '../db/supabase.ts';
import type { Fonte } from '../tipos.ts';
import { normalizarCargo } from '../dedupe.ts';
import { chaveDaDecisao } from './classificador.ts';
import { classesDeFamilia, tokensDeFamilia } from './familia.ts';
import { normalizarLocal } from '../normalize/local.ts';
import type { Candidato, Decisao } from './tipos.ts';

interface LinhaRaw {
  id: number;
  fonte: string;
  fonte_id: string | null;
  url_canonica: string;
  titulo: string;
  snippet: string | null;
  cargo_busca: string;
  localizacao_busca: string | null;
  data_publicacao: string | null;
  data_publicacao_origem: string | null;
  data_coleta: string;
}

const COLUNAS =
  'id,fonte,fonte_id,url_canonica,titulo,snippet,cargo_busca,localizacao_busca,data_publicacao,data_publicacao_origem,data_coleta';

/**
 * Pendentes, do mais novo para o mais velho.
 *
 * A ordem importa quando o limite corta: com a janela de 7 dias, o que ficar
 * para a próxima rodada pode já ter vencido. Classificar o recente primeiro
 * perde menos.
 */
export async function lerPendentes(db: SupabaseRest, limite: number): Promise<Candidato[]> {
  const linhas = await db.select<LinhaRaw>(
    'raw_results',
    `select=${COLUNAS}&processado=is.false&order=data_coleta.desc&limit=${limite}`,
  );

  return linhas.map((l) => ({
    id: l.id,
    fonte: l.fonte as Fonte,
    fonteId: l.fonte_id,
    urlCanonica: l.url_canonica,
    titulo: l.titulo,
    snippet: l.snippet ?? '',
    cargoBusca: l.cargo_busca,
    localizacaoBusca: l.localizacao_busca,
    dataPublicacao: l.data_publicacao,
    dataPublicacaoOrigem: l.data_publicacao_origem,
    dataColeta: l.data_coleta,
  }));
}

/** Linha de `jobs` a partir de uma decisão aprovada. */
export function paraLinhaJob(decisao: Decisao): Record<string, unknown> {
  const { candidato, extracao } = decisao;
  const cargo = extracao?.cargo ?? candidato.titulo;
  const local = normalizarLocal(extracao?.localizacao);

  return {
    raw_result_id: candidato.id,
    dedup_key: chaveDaDecisao(decisao),
    dedup_por_empresa: Boolean(extracao?.empresa),
    empresa: extracao?.empresa ?? 'não identificada',
    cargo,
    // Mesma normalização da chave de dedup: o feed vai facetar por esta coluna,
    // e duas normalizações diferentes fariam a faceta discordar da dedup.
    cargo_normalizado: normalizarCargo(cargo),
    // O que o feed realmente filtra. `cargo_normalizado` não serve para isso:
    // são 15+ valores distintos para 6 cargos, e igualdade devolve quase nada.
    familia_tokens: tokensDeFamilia(cargo),
    familia_classes: classesDeFamilia(cargo),
    senioridade: extracao?.senioridade ?? null,
    modelo: extracao?.modelo ?? null,
    localizacao: extracao?.localizacao ?? null,
    cidade_slug: local.cidadeSlug,
    uf: local.uf,
    pais_br: local.paisBr,
    // Marca que ESTA linha passou pelo portão de local. As 197 primeiras não
    // passaram — foram classificadas antes de ele existir — e sem a marca não
    // dá para distinguir "o portão aprovou" de "o portão não rodou".
    local_avaliado: decisao.estagio === 'llm',
    url: candidato.urlCanonica,
    fonte: candidato.fonte,
    descricao: candidato.snippet || null,
    data_publicacao: candidato.dataPublicacao,
    data_publicacao_origem: candidato.dataPublicacaoOrigem ?? 'desconhecida',
    // Herdada de `raw_results`, NUNCA `default now()`. Reclassificar reescreve
    // a linha, e sem isto o acervo inteiro é carimbado como coletado hoje —
    // a janela de 7 dias se renovaria sozinha a cada rodada.
    data_coleta: candidato.dataColeta ?? new Date().toISOString(),
    classificado_em: new Date().toISOString(),
    classificador: decisao.classificador,
    confianca: decisao.confianca,
  };
}

export interface ResultadoGravacao {
  vagasGravadas: number;
  jaConhecidas: number;
  marcados: number;
  pendentesPorErro: number;
}

/**
 * Grava as vagas aprovadas e carimba as linhas de `raw_results`.
 *
 * Ordem que importa: a vaga entra em `jobs` ANTES de a origem ser marcada como
 * processada. Se a gravação falhar no meio, o pior caso é reclassificar o item
 * na próxima rodada — o contrário perderia a vaga em silêncio.
 *
 * `erro` não marca `processado`: cota estourada e falha de rede não são
 * veredito sobre a vaga, e o item precisa voltar.
 */
export async function gravar(db: SupabaseRest, decisoes: Decisao[]): Promise<ResultadoGravacao> {
  const aprovadas = decisoes.filter((d) => d.veredito === 'aprovado');

  let vagasGravadas = 0;
  if (aprovadas.length > 0) {
    const gravadas = await db.insert<{ id: number }>('jobs', aprovadas.map(paraLinhaJob), {
      ignorarDuplicados: true,
      conflito: 'dedup_key',
      retornar: true,
    });
    vagasGravadas = gravadas.length;
  }

  // Agrupa por (veredito, motivo, estágio): um PATCH por grupo em vez de um por
  // linha. Com 300 pendentes isso é a diferença entre 5 requisições e 300.
  const grupos = new Map<string, { decisoes: Decisao[]; campos: Record<string, unknown> }>();
  const agora = new Date().toISOString();

  for (const d of decisoes) {
    if (d.candidato.id === null) continue;
    const chave = `${d.veredito}|${d.motivo ?? ''}|${d.estagio}|${d.classificador}`;
    const grupo = grupos.get(chave);
    if (grupo) {
      grupo.decisoes.push(d);
      continue;
    }
    grupos.set(chave, {
      decisoes: [d],
      campos: {
        processado: d.veredito !== 'erro',
        classificacao: d.veredito,
        classificacao_motivo: d.motivo,
        classificacao_estagio: d.estagio,
        classificado_em: agora,
        classificador: d.classificador,
      },
    });
  }

  let marcados = 0;
  let pendentesPorErro = 0;

  for (const { decisoes: doGrupo, campos } of grupos.values()) {
    const ids = doGrupo.map((d) => d.candidato.id!);
    // PostgREST tem limite de tamanho de URL: mesmo critério de `hashesExistentes`.
    for (let i = 0; i < ids.length; i += 150) {
      const lote = ids.slice(i, i + 150);
      await db.update('raw_results', `id=in.(${lote.join(',')})`, campos);
      marcados += lote.length;
    }
    if (campos['processado'] === false) pendentesPorErro += ids.length;
  }

  log.info('gravação concluída', {
    aprovadas: aprovadas.length,
    vagasGravadas,
    jaConhecidas: aprovadas.length - vagasGravadas,
    marcados,
    pendentesPorErro,
  });

  return {
    vagasGravadas,
    jaConhecidas: aprovadas.length - vagasGravadas,
    marcados,
    pendentesPorErro,
  };
}
