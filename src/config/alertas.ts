/**
 * Alertas do Google Alerts — a fonte que substitui a PSE.
 *
 * COMO PREENCHER
 *   1. Em google.com/alerts, cole o texto de `consulta` no campo de busca.
 *   2. Antes de criar, olhe a PRÉVIA — ela mostra resultados na hora. É ali que
 *      se mede precisão, sem esperar uma semana.
 *   3. Mostrar opções → Entregar em: **Feed RSS** (não e-mail).
 *      Frequência: "à medida que acontecer". Fontes: "Automático".
 *      Idioma: Português. Região: Brasil.
 *   4. Criado o alerta, clique no ícone RSS e cole a URL em `feedUrl` abaixo.
 *
 * As consultas são as do Passo 1. Se o Alerts ignorar algum operador, é a
 * prévia do passo 2 que vai mostrar — não confie, verifique.
 */
import type { Fonte, Modelo } from '../tipos.ts';

export interface Alerta {
  id: string;
  cargo: string;
  modelo: Modelo;
  localizacao: string | null;
  /** O texto exato a colar em google.com/alerts. */
  consulta: string;
  /** Que fonte se espera dominar aqui. Serve para conferir o que chega. */
  fonteEsperada: Exclude<Fonte, 'desconhecida'>;
  /** URL do feed RSS. `null` = alerta ainda não criado. */
  feedUrl: string | null;
  ativo: boolean;
}

export const ALERTAS: Alerta[] = [
  {
    id: 'pm-bh-job',
    cargo: 'Product Manager',
    modelo: 'qualquer',
    localizacao: 'Belo Horizonte',
    consulta: 'site:linkedin.com/jobs/view "Product Manager" "Belo Horizonte"',
    fonteEsperada: 'linkedin_job',
    feedUrl: 'https://www.google.com/alerts/feeds/16549780003450680571/3469699774417139819',
    ativo: true,
  },
  {
    id: 'pm-remoto-job',
    cargo: 'Product Manager',
    modelo: 'remoto',
    localizacao: null,
    consulta:
      'site:linkedin.com/jobs/view "Product Manager" ("remoto" OR "home office" OR "100% remoto")',
    fonteEsperada: 'linkedin_job',
    feedUrl: 'https://www.google.com/alerts/feeds/16549780003450680571/14848090260388894556',
    ativo: true,
  },
  {
    id: 'pm-bh-gupy',
    cargo: 'Product Manager',
    modelo: 'remoto',
    localizacao: 'Belo Horizonte',
    consulta: 'site:gupy.io "Product Manager" ("Belo Horizonte" OR "remoto")',
    fonteEsperada: 'ats_gupy',
    feedUrl: 'https://www.google.com/alerts/feeds/16549780003450680571/15399087825688553350',
    ativo: true,
  },
  {
    id: 'pm-remoto-post-titulo',
    cargo: 'Product Manager',
    modelo: 'remoto',
    localizacao: null,
    // O diferencial do produto. Sem dateRestrict: no Alerts, frescor é intrínseco.
    // `intitle:` faz parte do dork validado no Passo 1 — foi ele que deu ~100%
    // de precisão. Tirar aqui teria criado uma variante não medida.
    consulta:
      'site:linkedin.com/posts intitle:"product manager" ("contratando" OR "vaga" OR "hiring") -curso -mentoria -programa',
    fonteEsperada: 'linkedin_post',
    feedUrl: 'https://www.google.com/alerts/feeds/16549780003450680571/2169284706479048979',
    ativo: true,
  },
  {
    id: 'pm-remoto-post-corpo',
    cargo: 'Product Manager',
    modelo: 'remoto',
    localizacao: null,
    consulta:
      'site:linkedin.com/posts "product manager" ("requisitos" OR "benefícios" OR "CLT" OR "PJ") ("vaga" OR "contratando") -curso -mentoria -programa',
    fonteEsperada: 'linkedin_post',
    feedUrl: 'https://www.google.com/alerts/feeds/16549780003450680571/7660055469178673414',
    ativo: true,
  },
];

export function alertasProntos(alertas: Alerta[] = ALERTAS): Alerta[] {
  return alertas.filter((a) => a.ativo && a.feedUrl !== null);
}

export function alertasPendentes(alertas: Alerta[] = ALERTAS): Alerta[] {
  return alertas.filter((a) => a.ativo && a.feedUrl === null);
}
