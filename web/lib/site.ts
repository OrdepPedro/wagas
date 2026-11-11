/**
 * Endereço canônico do site. O apex `wagas.com.br` redireciona 308 para o www
 * na Vercel, então é o www que o buscador deve indexar — canonical, sitemap e
 * Open Graph saem todos daqui.
 */
export const URL_DO_SITE = 'https://www.wagas.com.br';

/**
 * Metadata de uma página pública: título, descrição, canonical e Open Graph
 * juntos. O `openGraph` do layout é substituído inteiro (não mesclado) por
 * quem declara o próprio, então sem isto a prévia do link de uma subpágina
 * sairia com o título e a URL da home.
 */
export function metadataDaPagina(caminho: string, titulo: string, descricao: string) {
  return {
    title: titulo,
    description: descricao,
    alternates: { canonical: caminho },
    openGraph: {
      type: 'website' as const,
      locale: 'pt_BR',
      siteName: 'wagas',
      url: caminho,
      title: `${titulo} · wagas`,
      description: descricao,
      // A imagem de `app/opengraph-image.tsx` só é herdada por quem não
      // declara `openGraph`; aqui ela precisa ser dita.
      images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
    },
  };
}
