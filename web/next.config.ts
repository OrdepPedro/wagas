import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { NextConfig } from 'next';

/**
 * `../src` fica FORA da pasta do Next de propósito.
 *
 * O feed usa exatamente os mesmos módulos que o classificador usou para gravar
 * (`consultaDeFeed`, `slugCidade`, `filtroDeFamilia`). Copiar esse código para
 * cá criaria uma segunda implementação da regra de família e da normalização de
 * cidade — e o sintoma de as duas divergirem é feed vazio sem causa aparente.
 *
 * `outputFileTracingRoot` aponta para a raiz do repositório para o build da
 * Vercel enxergar esses arquivos. Via `fileURLToPath`, não `URL.pathname`: no
 * Windows este devolve `/C:/...`, que o Turbopack não consegue canonicalizar.
 */
const config: NextConfig = {
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  typedRoutes: true,
  // Não anuncia o framework em toda resposta.
  poweredByHeader: false,
  /**
   * Cabeçalhos de segurança (varredura de 09/11).
   *
   * O que importa aqui é o site não poder ser embutido em iframe de terceiro:
   * "apagar meu currículo" é um clique, e clique dá para induzir por cima de um
   * iframe invisível. `frame-ancestors` é a tranca atual e `X-Frame-Options` a
   * dos navegadores antigos. A extensão não é afetada: o painel dela é página
   * própria que chama a API por `fetch`, não embute o site.
   *
   * A CSP só traz `frame-ancestors`, `base-uri` e `form-action` de propósito.
   * Restringir `script-src` exige nonce por requisição (o Next injeta script
   * inline), e fazer isso pela metade quebra o site sem proteger nada.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
  // O medidor de currículo recebe o arquivo pela Server Action. O padrão é
  // 1 MB, menor que muito PDF com fonte embutida; o teto do medidor é 5 MB.
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
  },
};

export default config;
