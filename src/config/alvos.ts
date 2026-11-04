/**
 * Alvos de coleta na premissa atual do produto: **cargo + cidade**.
 *
 * O usuário informa só isso. O feed devolve, para os últimos 7 dias:
 *   - vagas presenciais e híbridas NA CIDADE dele;
 *   - vagas remotas de TODO O BRASIL.
 *
 * Por isso cada bloco vira duas consultas — `cidade` e `remoto`. Um alvo
 * completo custa 4 blocos x 2 recortes x N páginas.
 *
 * ESTE É O ARQUIVO PARA EDITAR ao cobrir um segmento novo.
 *
 * Diferença para `searches.ts`: lá ficam os 5 dorks do Passo 1, congelados como
 * referência histórica para comparação e para a paridade com o Google Alerts.
 * Aqui fica a configuração de produção. Os templates de dork vivem só aqui.
 */
import type { Fonte } from '../tipos.ts';

/** Janela do Google: o produto promete vaga de no máximo 7 dias. */
export const JANELA = 'qdr:w';

const TERMO_REMOTO = '("remoto" OR "home office" OR "100% remoto")';
const RUIDO_POSTS = '-curso -mentoria -programa';

export type Bloco = Exclude<Fonte, 'desconhecida'>;
export type Recorte = 'cidade' | 'remoto';

export interface Alvo {
  /** Id estável — vai para `raw_results.combo_id`. Não renomear em produção. */
  id: string;
  cargo: string;
  cidade: string;
  ativo: boolean;
}

export interface Consulta {
  alvo: Alvo;
  bloco: Bloco;
  recorte: Recorte;
  dork: string;
  pagina: number;
}

// ---------------------------------------------------------------------------
// Templates de dork — os validados no Passo 1, sem termo acrescentado
// ---------------------------------------------------------------------------

/**
 * Nenhum destes leva termo além do medido. Acrescentar um termo a um dork
 * validado invalida a precisão medida; se mudar, medir de novo.
 */
export function montarDork(bloco: Bloco, cargo: string, recorte: Recorte, cidade: string): string {
  const local = recorte === 'cidade' ? `"${cidade}"` : TERMO_REMOTO;

  if (bloco === 'linkedin_job') {
    return `site:linkedin.com/jobs/view "${cargo}" ${local}`;
  }

  if (bloco === 'linkedin_post') {
    // `intitle:` é o pré-filtro por título, aplicado pelo Google na origem — o
    // campo `title` que a API devolve para post vem reescrito ("Fulano posted
    // this") e não serve para filtrar depois.
    return `site:linkedin.com/posts intitle:"${cargo.toLowerCase()}" ("contratando" OR "vaga" OR "hiring") ${local} ${RUIDO_POSTS}`;
  }

  // Gupy: no recorte remoto o termo composto derruba demais o recall desta fonte.
  // InHire herda o mesmo molde, SEM medição própria: é um ATS da mesma forma
  // (subdomínio por empresa, página por vaga), e o molde da Gupy é o mais
  // próximo de medido que existe. Caminho no `site:` arriscaria perder os
  // subdomínios; a página que não é de vaga única cai no pré-filtro.
  const localAts = recorte === 'cidade' ? `"${cidade}"` : '"remoto"';
  if (bloco === 'ats_inhire') return `site:inhire.app "${cargo}" ${localAts}`;
  return `site:gupy.io "${cargo}" ${localAts}`;
}

// ---------------------------------------------------------------------------
// Alvos ativos
// ---------------------------------------------------------------------------

export const ALVOS: Alvo[] = [
  { id: 'pm-bh', cargo: 'Product Manager', cidade: 'Belo Horizonte', ativo: true },
  { id: 'pm-sp', cargo: 'Product Manager', cidade: 'São Paulo', ativo: true },
  { id: 'pd-sp', cargo: 'Product Designer', cidade: 'São Paulo', ativo: true },
  { id: 'front-sp', cargo: 'Desenvolvedor Front-end', cidade: 'São Paulo', ativo: true },
  { id: 'dados-sp', cargo: 'Analista de Dados', cidade: 'São Paulo', ativo: true },
  // Fora do núcleo tech: medido em 23/08 e funciona (ver CLAUDE.md).
  { id: 'mkt-sp', cargo: 'Analista de Marketing', cidade: 'São Paulo', ativo: true },
  { id: 'adm-sp', cargo: 'Auxiliar Administrativo', cidade: 'São Paulo', ativo: true },
  // Entrou pela fila de demanda (26/08): o Pedro buscou "Senior UX Designer" e
  // viu um post de recrutador do mesmo dia que o feed não tinha. É o primeiro
  // teste do bloco de posts num cargo verificável à mão.
  { id: 'ux-bh', cargo: 'UX Designer', cidade: 'Belo Horizonte', ativo: true },
];

const BLOCOS: Bloco[] = ['linkedin_job', 'linkedin_post', 'ats_gupy', 'ats_inhire'];
const RECORTES: Recorte[] = ['cidade', 'remoto'];

export function alvosAtivos(alvos: Alvo[] = ALVOS): Alvo[] {
  return alvos.filter((a) => a.ativo);
}

export function validarAlvos(alvos: Alvo[] = ALVOS): void {
  const vistos = new Set<string>();
  for (const a of alvos) {
    if (vistos.has(a.id)) throw new Error(`alvo com id duplicado: ${a.id}`);
    vistos.add(a.id);
    if (!a.cargo.trim() || !a.cidade.trim()) {
      throw new Error(`alvo ${a.id}: cargo e cidade são obrigatórios`);
    }
  }
}

export function expandirAlvo(alvo: Alvo, paginas: number): Consulta[] {
  const consultas: Consulta[] = [];
  for (const bloco of BLOCOS) {
    for (const recorte of RECORTES) {
      for (let pagina = 1; pagina <= paginas; pagina++) {
        consultas.push({
          alvo,
          bloco,
          recorte,
          dork: montarDork(bloco, alvo.cargo, recorte, alvo.cidade),
          pagina,
        });
      }
    }
  }
  return consultas;
}

export function expandirTodos(paginas: number, alvos: Alvo[] = ALVOS): Consulta[] {
  return alvosAtivos(alvos).flatMap((a) => expandirAlvo(a, paginas));
}

/** Créditos que um ciclo completo consome, no pior caso (sem parada antecipada). */
export function custoDoCiclo(paginas: number, alvos: Alvo[] = ALVOS): number {
  return alvosAtivos(alvos).length * BLOCOS.length * RECORTES.length * paginas;
}

validarAlvos();
