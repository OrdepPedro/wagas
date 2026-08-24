/**
 * Formato de item de busca COM `pagemap` — herdado da Custom Search JSON API.
 *
 * A API morreu, mas o formato não: `normalizarItem` e a extração de data por
 * metatag em `normalize/datas.ts` continuam válidos para qualquer fonte que
 * devolva metadados estruturados da página (DataForSEO, por exemplo).
 *
 * A fonte de produção hoje é a Serper, que NÃO devolve `pagemap` — o caminho
 * dela é `src/serper/normalizar.ts`. Isto aqui é o caminho alternativo, mantido
 * por ser barato e por já estar coberto de testes.
 */

export interface PseItem {
  title?: string;
  link?: string;
  snippet?: string;
  htmlSnippet?: string;
  displayLink?: string;
  formattedUrl?: string;
  /**
   * Metadados estruturados extraídos da página pelo Google.
   * As chaves de metatag vêm em minúsculas (`article:published_time`).
   */
  pagemap?: {
    metatags?: Array<Record<string, string>>;
    [chave: string]: unknown;
  };
}

export interface PseResposta {
  items?: PseItem[];
  searchInformation?: {
    totalResults?: string;
    searchTime?: number;
  };
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}
