/**
 * Canonicalização de URL — a base da deduplicação.
 *
 * O mesmo anúncio chega com hosts e query strings diferentes:
 *   br.linkedin.com/jobs/view/product-manager-at-acme-4012345678?refId=abc
 *   www.linkedin.com/jobs/view/4012345678?trackingId=xyz
 * As duas viram a mesma URL canônica e, portanto, o mesmo hash.
 *
 * Para LinkedIn e Gupy a canonicalização é agressiva de propósito: reduz a URL
 * ao identificador estável da vaga/post. Domínios desconhecidos caem na regra
 * genérica (https, sem parâmetro de tracking, sem fragmento).
 */
import { createHash } from 'node:crypto';
import type { Fonte } from '../tipos.ts';

export interface UrlCanonica {
  url: string;
  fonte: Fonte;
  /** Id nativo da fonte: jobId do LinkedIn, activity id do post, id da vaga na Gupy. */
  fonteId: string | null;
}

const PARAMS_DESCARTAVEIS = new Set([
  'ref',
  'refid',
  'trk',
  'trkinfo',
  'trackingid',
  'originalsubdomain',
  'position',
  'pagenum',
  'ebp',
  'lipi',
  'licu',
  'midtoken',
  'midsig',
  'otptoken',
  'eboriginalsubdomain',
  'jobboardsource',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'src',
  'source',
]);

function ehDescartavel(chave: string): boolean {
  const k = chave.toLowerCase();
  return k.startsWith('utm_') || PARAMS_DESCARTAVEIS.has(k);
}

function limparCaminho(caminho: string): string {
  const semBarra = caminho.replace(/\/+$/, '');
  return semBarra === '' ? '/' : semBarra;
}

function queryLimpa(url: URL): string {
  const params = [...url.searchParams.entries()].filter(([chave]) => !ehDescartavel(chave));
  if (params.length === 0) return '';
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '?' + params.map(([c, v]) => `${c}=${v}`).join('&');
}

function ultimoSegmento(caminho: string): string {
  const partes = caminho.split('/').filter(Boolean);
  return partes[partes.length - 1] ?? '';
}

function idDeVagaLinkedin(url: URL): string | null {
  const doCaminho = /(\d{8,})$/.exec(ultimoSegmento(url.pathname));
  if (doCaminho?.[1]) return doCaminho[1];
  const doParametro = url.searchParams.get('currentJobId');
  return doParametro && /^\d{8,}$/.test(doParametro) ? doParametro : null;
}

function idDeAtividadeLinkedin(url: URL): string | null {
  const alvo = decodeURIComponent(url.pathname);
  const m = /activity[-:](\d{10,})/i.exec(alvo);
  return m?.[1] ?? null;
}

function idDeVagaGupy(url: URL): string | null {
  const m = /\/jobs?\/(\d{3,})/.exec(url.pathname);
  return m?.[1] ?? null;
}

/** Retorna `null` quando a URL não é aproveitável (protocolo estranho, string quebrada). */
export function canonicalizarUrl(bruta: string): UrlCanonica | null {
  if (typeof bruta !== 'string' || bruta.trim() === '') return null;

  let url: URL;
  try {
    url = new URL(bruta.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    if (/\/jobs\/view\b/.test(url.pathname)) {
      const id = idDeVagaLinkedin(url);
      if (id) {
        return {
          url: `https://www.linkedin.com/jobs/view/${id}`,
          fonte: 'linkedin_job',
          fonteId: id,
        };
      }
    }
    if (/\/(posts|feed\/update)\//.test(url.pathname)) {
      const id = idDeAtividadeLinkedin(url);
      if (id) {
        return {
          url: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
          fonte: 'linkedin_post',
          fonteId: id,
        };
      }
      return {
        url: `https://www.linkedin.com${limparCaminho(url.pathname)}`,
        fonte: 'linkedin_post',
        fonteId: null,
      };
    }
  }

  if (host === 'gupy.io' || host.endsWith('.gupy.io')) {
    // O subdomínio identifica a empresa: não pode ser normalizado fora.
    const id = idDeVagaGupy(url);
    if (id) {
      return { url: `https://${host}/jobs/${id}`, fonte: 'ats_gupy', fonteId: id };
    }
    return {
      url: `https://${host}${limparCaminho(url.pathname)}${queryLimpa(url)}`,
      fonte: 'ats_gupy',
      fonteId: null,
    };
  }

  if (host === 'infojobs.com.br' || host.endsWith('.infojobs.com.br')) {
    // `/vaga-de-<titulo>-em-<cidade>__12110964.aspx`: o slug do título muda se o
    // anunciante editar; o número não. Canonicaliza pelo número.
    const id = /__(\d+)\.aspx$/i.exec(url.pathname)?.[1];
    if (id) {
      return {
        url: `https://www.infojobs.com.br${limparCaminho(url.pathname)}`,
        fonte: 'portal_infojobs',
        fonteId: id,
      };
    }
  }

  return {
    url: `https://${host}${limparCaminho(url.pathname)}${queryLimpa(url)}`,
    fonte: 'desconhecida',
    fonteId: null,
  };
}

/** Chave de dedup em raw_results. sha256 hex da URL canônica. */
export function hashUrl(urlCanonica: string): string {
  return createHash('sha256').update(urlCanonica, 'utf8').digest('hex');
}
