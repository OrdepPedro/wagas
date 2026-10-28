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
  // O medidor de currículo recebe o arquivo pela Server Action. O padrão é
  // 1 MB, menor que muito PDF com fonte embutida; o teto do medidor é 5 MB.
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
  },
};

export default config;
