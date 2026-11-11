import type { MetadataRoute } from 'next';
import { caminhoDaPagina, PAGINAS_PUBLICAS } from '../../src/feed/paginas-publicas.ts';
import { URL_DO_SITE } from '../lib/site.ts';

/** Só as páginas públicas, as mesmas que `robots.ts` libera. */
// Fica de fora quem está com `noindex` por falta de vaga: o sitemap é estático
// e não lê o banco. O Google lê o `noindex` na própria página e a descarta.
export default function sitemap(): MetadataRoute.Sitemap {
  const paginas: Array<[string, MetadataRoute.Sitemap[number]['changeFrequency'], number]> = [
    ['', 'daily', 1],
    ['/funcionalidades/ats', 'monthly', 0.8],
    ['/funcionalidades/estruturar', 'monthly', 0.8],
    ['/funcionalidades/dorks', 'monthly', 0.7],
    ['/privacidade', 'yearly', 0.2],
  ];
  return [
    ...paginas.map(([caminho, changeFrequency, priority]) => ({
      url: `${URL_DO_SITE}${caminho}`,
      changeFrequency,
      priority,
    })),
    // Páginas por cargo × cidade: mudam todo dia, com a coleta das 04h.
    ...PAGINAS_PUBLICAS.map((p) => ({
      url: `${URL_DO_SITE}${caminhoDaPagina(p)}`,
      changeFrequency: 'daily' as const,
      priority: 0.9,
    })),
  ];
}
