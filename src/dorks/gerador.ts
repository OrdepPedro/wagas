/**
 * Gerador de dorks para o candidato pesquisar sozinho no Google.
 *
 * Funcionalidade gratuita e 100% no navegador: monta o texto da busca e o link,
 * e quem executa a busca é a própria pessoa. Nenhuma chamada à Serper — a regra
 * crítica do CLAUDE.md (request de usuário nunca chega na API paga) vale aqui.
 *
 * Os templates de LinkedIn Jobs, posts e Gupy são os de `montarDork`, os
 * validados no Passo 1. Os demais sites (InfoJobs e ATSs por empresa) seguem o
 * mesmo molde `site:<caminho da vaga> "<cargo>" <local>` e NÃO foram medidos.
 */
import { montarDork } from '../config/alvos.ts';

export type Periodo = 'dia' | 'semana' | 'mes' | 'qualquer';

export const PERIODOS: { id: Periodo; rotulo: string; tbs: string | null }[] = [
  { id: 'dia', rotulo: 'Últimas 24 horas', tbs: 'qdr:d' },
  { id: 'semana', rotulo: 'Últimos 7 dias', tbs: 'qdr:w' },
  { id: 'mes', rotulo: 'Último mês', tbs: 'qdr:m' },
  { id: 'qualquer', rotulo: 'Qualquer data', tbs: null },
];

export interface Site {
  id: string;
  nome: string;
  /** Validado no Passo 1 (precisão medida) ou só montado no mesmo molde. */
  medido: boolean;
  montar: (cargo: string, local: Local) => string;
}

type Local = { cidade: string } | { remoto: true } | null;

const TERMO_REMOTO = '("remoto" OR "home office" OR "100% remoto")';

function termoDeLocal(local: Local): string | null {
  if (!local) return null;
  return 'remoto' in local ? TERMO_REMOTO : `"${local.cidade}"`;
}

function molde(caminho: string) {
  return (cargo: string, local: Local) =>
    [`site:${caminho}`, `"${cargo}"`, termoDeLocal(local)].filter(Boolean).join(' ');
}

/** Dork de produção quando há local; sem local, o mesmo dork sem o termo final. */
function validado(bloco: 'linkedin_job' | 'linkedin_post') {
  return (cargo: string, local: Local) => {
    if (local) {
      return 'remoto' in local
        ? montarDork(bloco, cargo, 'remoto', '')
        : montarDork(bloco, cargo, 'cidade', local.cidade);
    }
    return montarDork(bloco, cargo, 'cidade', '').replace(' ""', '');
  };
}

export const SITES: Site[] = [
  { id: 'linkedin_job', nome: 'LinkedIn Vagas', medido: true, montar: validado('linkedin_job') },
  { id: 'linkedin_post', nome: 'Posts do LinkedIn', medido: true, montar: validado('linkedin_post') },
  { id: 'gupy', nome: 'Gupy', medido: true, montar: molde('gupy.io') },
  { id: 'infojobs', nome: 'InfoJobs', medido: false, montar: molde('infojobs.com.br') },
  { id: 'greenhouse', nome: 'Greenhouse', medido: false, montar: molde('boards.greenhouse.io') },
  { id: 'lever', nome: 'Lever', medido: false, montar: molde('jobs.lever.co') },
  { id: 'ashby', nome: 'Ashby', medido: false, montar: molde('jobs.ashbyhq.com') },
];

export interface PedidoDeDork {
  cargo: string;
  sites: string[];
  periodo: Periodo;
  /** Cidade livre; ignorada quando `remoto` está ligado, como no feed. */
  cidade?: string;
  remoto?: boolean;
}

export interface Dork {
  site: Site;
  consulta: string;
  url: string;
}

/** Aspas do usuário quebrariam a frase exata do dork. */
function limpar(texto: string): string {
  return texto.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
}

export function gerarDorks(pedido: PedidoDeDork): Dork[] {
  const cargo = limpar(pedido.cargo);
  if (!cargo) return [];

  const cidade = limpar(pedido.cidade ?? '');
  const local: Local = pedido.remoto ? { remoto: true } : cidade ? { cidade } : null;
  const tbs = PERIODOS.find((p) => p.id === pedido.periodo)?.tbs ?? null;

  return SITES.filter((s) => pedido.sites.includes(s.id)).map((site) => {
    const consulta = site.montar(cargo, local);
    const params = new URLSearchParams({ q: consulta });
    if (tbs) params.set('tbs', tbs);
    return { site, consulta, url: `https://www.google.com/search?${params}` };
  });
}
