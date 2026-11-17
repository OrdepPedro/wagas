import type { MetadataRoute } from 'next';
import { caminhoDaPagina, PAGINAS_PUBLICAS } from '../../src/feed/paginas-publicas.ts';
import { lerVagasPublicas } from '../lib/acervo-publico.ts';
import { URL_DO_SITE } from '../lib/site.ts';

// Literal, igual ao da página `vagas-de`: o Next não aceita valor importado.
export const revalidate = 3600;

/**
 * Só as páginas públicas, as mesmas que `robots.ts` libera — e, entre as de
 * cargo × cidade, só as que têm vaga hoje.
 *
 * Página sem vaga sai com `noindex` (ver `vagas-de/.../page.tsx`). Listá-la no
 * sitemap é mandar o Google a uma página que a própria página recusa, e o
 * Search Console acusa a contradição ("Excluída pela tag noindex"). A leitura é
 * a mesma da página, com o mesmo cache de uma hora, então os dois concordam.
 *
 * Falha de leitura (null) mantém a página no sitemap, pelo mesmo motivo da
 * página não virar noindex: um soluço do banco não tira nada do índice.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const paginas: Array<[string, MetadataRoute.Sitemap[number]['changeFrequency'], number]> = [
    ['', 'daily', 1],
    ['/funcionalidades/ats', 'monthly', 0.8],
    ['/funcionalidades/estruturar', 'monthly', 0.8],
    ['/funcionalidades/dorks', 'monthly', 0.7],
    ['/privacidade', 'yearly', 0.2],
  ];

  const comVaga = await Promise.all(
    PAGINAS_PUBLICAS.map(async (p) => {
      const lido = await lerVagasPublicas(p.cargo, p.cidade?.nome ?? null);
      return lido?.vagas.length === 0 ? null : p;
    }),
  );

  return [
    ...paginas.map(([caminho, changeFrequency, priority]) => ({
      url: `${URL_DO_SITE}${caminho}`,
      changeFrequency,
      priority,
    })),
    // Páginas por cargo × cidade: mudam todo dia, com a coleta das 04h.
    ...comVaga
      .filter((p) => p !== null)
      .map((p) => ({
        url: `${URL_DO_SITE}${caminhoDaPagina(p)}`,
        changeFrequency: 'daily' as const,
        priority: 0.9,
      })),
  ];
}
