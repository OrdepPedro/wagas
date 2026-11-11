import { ImageResponse } from 'next/og';

/**
 * Imagem da prévia do link (LinkedIn, WhatsApp, X). O tráfego de hoje vem
 * quase todo de link compartilhado no LinkedIn, e sem esta imagem o cartão
 * sai só com texto. Herdada por toda página que não tiver a própria.
 */
export const alt = 'wagas — vagas de emprego publicadas nesta semana';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Imagem() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: '#0f1115',
          color: '#f5f5f5',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 44, fontWeight: 700, opacity: 0.85 }}>wagas</div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 36, lineHeight: 1.1 }}>
          Chega de anúncio velho.
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, color: '#ffd84d', lineHeight: 1.1 }}>
          Só vagas desta semana.
        </div>
        <div style={{ fontSize: 34, marginTop: 40, opacity: 0.75 }}>
          Seu cargo, sua cidade e remoto de todo o Brasil. Grátis.
        </div>
      </div>
    ),
    size,
  );
}
