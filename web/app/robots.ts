import type { MetadataRoute } from 'next';
import { URL_DO_SITE } from '../lib/site.ts';

/**
 * O que o buscador pode ler: a landing, as funcionalidades e a privacidade.
 *
 * Fica de fora o que depende de sessão (feed, currículo, adaptação), o que é
 * redirecionamento (`/ir/[id]` — rastrear isso contaria clique de robô na
 * métrica do produto) e as rotas de API e de login.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // `/vagas$` e `/vagas?`, não `/vagas`: robots.txt casa por prefixo, e
      // `/vagas` sozinho bloquearia também as páginas públicas `/vagas-de/...`.
      disallow: ['/vagas$', '/vagas?', '/curriculo', '/adaptar/', '/ir/', '/entrar', '/api/', '/auth/'],
    },
    sitemap: `${URL_DO_SITE}/sitemap.xml`,
    host: URL_DO_SITE,
  };
}
