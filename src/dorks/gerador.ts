/**
 * Gerador de dorks para o candidato pesquisar sozinho no Google.
 *
 * Funcionalidade gratuita e 100% no navegador: monta o texto da busca e o link,
 * e quem executa a busca é a própria pessoa. Nenhuma chamada à Serper — a regra
 * crítica do CLAUDE.md (request de usuário nunca chega na API paga) vale aqui.
 *
 * Os templates de LinkedIn Jobs, posts e Gupy são os de `montarDork`, os
 * validados no Passo 1. Os portais brasileiros foram medidos em 28/10 — ver
 * o comentário em `SITES`.
 */
import { montarDork } from '../config/alvos.ts';

export type Periodo = 'dia' | 'semana' | 'mes' | 'qualquer';

export const PERIODOS: { id: Periodo; rotulo: string; tbs: string | null }[] = [
  { id: 'dia', rotulo: 'Últimas 24 horas', tbs: 'qdr:d' },
  { id: 'semana', rotulo: 'Últimos 7 dias', tbs: 'qdr:w' },
  { id: 'mes', rotulo: 'Último mês', tbs: 'qdr:m' },
  { id: 'qualquer', rotulo: 'Qualquer data', tbs: null },
];

export type Grupo = 'LinkedIn' | 'Portais brasileiros';

export const GRUPOS: Grupo[] = ['LinkedIn', 'Portais brasileiros'];

export interface Site {
  id: string;
  nome: string;
  /** Validado no Passo 1 (precisão medida) ou só montado no mesmo molde. */
  medido: boolean;
  grupo: Grupo;
  montar: (cargo: string, local: Local) => string;
}

type Local = { cidade: string } | { remoto: true } | null;

const TERMO_REMOTO = '("remoto" OR "home office" OR "100% remoto")';

function termoDeLocal(local: Local): string | null {
  if (!local) return null;
  return 'remoto' in local ? TERMO_REMOTO : `"${local.cidade}"`;
}

/**
 * `site:<caminho> [filtro] "<cargo>" [local] [exclusão]`. O filtro existe porque
 * nos portais grandes o `site:` puro devolve quase só página de SEO (listagem por
 * cidade, salário, blog): medido em 28/10, 0–15% de página de vaga. O filtro
 * mira o formato da URL ou do título da vaga individual.
 */
function molde(caminho: string, filtro?: string, exclusao?: string) {
  return (cargo: string, local: Local) =>
    [`site:${caminho}`, filtro, `"${cargo}"`, termoDeLocal(local), exclusao].filter(Boolean).join(' ');
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
  { id: 'linkedin_job', nome: 'LinkedIn Vagas', grupo: 'LinkedIn', medido: true, montar: validado('linkedin_job') },
  { id: 'linkedin_post', nome: 'Posts do LinkedIn', grupo: 'LinkedIn', medido: true, montar: validado('linkedin_post') },

  // Portais: a busca roda no Google pela própria pessoa, então anti-bot e
  // robots.txt (que tiram Catho e Hays da COLETA) não se aplicam aqui.
  //
  // Medição de 28/10 pela Serper, 2 cargos (Auxiliar Administrativo, Analista
  // de Dados) x 10 resultados: com o filtro abaixo, 100% dos resultados são
  // página de vaga individual em todos os portais, inclusive com `qdr:w`. Mede
  // FORMATO, não cargo: BNE e Trabalha Brasil devolvem "Analista de Banco de
  // Dados" para "Analista de Dados".
  { id: 'gupy', nome: 'Gupy', grupo: 'Portais brasileiros', medido: true, montar: molde('gupy.io') },
  { id: 'infojobs', nome: 'InfoJobs', grupo: 'Portais brasileiros', medido: true, montar: molde('infojobs.com.br', 'inurl:vaga-de') },
  { id: 'vagas', nome: 'Vagas.com', grupo: 'Portais brasileiros', medido: true, montar: molde('vagas.com.br', 'intitle:Vaga') },
  { id: 'catho', nome: 'Catho', grupo: 'Portais brasileiros', medido: true, montar: molde('catho.com.br', 'intitle:"Vaga de Emprego de"') },
  { id: 'indeed', nome: 'Indeed Brasil', grupo: 'Portais brasileiros', medido: true, montar: molde('br.indeed.com/viewjob') },
  { id: 'glassdoor', nome: 'Glassdoor', grupo: 'Portais brasileiros', medido: true, montar: molde('glassdoor.com.br/job-listing') },
  { id: 'bne', nome: 'BNE', grupo: 'Portais brasileiros', medido: true, montar: molde('bne.com.br', 'inurl:vaga-de-emprego-na-area') },
  { id: 'trabalhabrasil', nome: 'Trabalha Brasil', grupo: 'Portais brasileiros', medido: true, montar: molde('trabalhabrasil.com.br', 'intitle:"Vaga de"') },
  { id: 'empregos', nome: 'Empregos.com.br', grupo: 'Portais brasileiros', medido: true, montar: molde('empregos.com.br/vaga') },
  { id: 'solides', nome: 'Sólides Vagas', grupo: 'Portais brasileiros', medido: true, montar: molde('vagas.solides.com.br', 'inurl:vaga', '-blog') },
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
  /**
   * Mesma busca sem o filtro de período. O `tbs` do Google filtra pela data do
   * índice, não da publicação (achado 19): vaga de 2 dias pode não ter entrado
   * ainda e a busca vem vazia. Null quando o período já é "qualquer".
   */
  urlSemPeriodo: string | null;
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
    // `udm=14` é a aba "Web" do Google. Sem ela, em 28/10, o Google reescrevia a
    // busca (modo IA) e ignorava `site:` sempre que havia aspas: o dork voltava
    // artigo de blog. A Serper honra os operadores com ou sem isso, e por isso a
    // medição pela API passou enquanto o link para o usuário falhava.
    const base = `https://www.google.com/search?${new URLSearchParams({ q: consulta, udm: '14' })}`;
    return {
      site,
      consulta,
      url: tbs ? `${base}&${new URLSearchParams({ tbs })}` : base,
      urlSemPeriodo: tbs ? base : null,
    };
  });
}
