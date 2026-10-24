'use client';

import { useEffect, useState } from 'react';

type Tema = 'light' | 'dark';

/**
 * Alterna claro/escuro. Sem escolha, o tema segue o sistema; ao clicar, a
 * escolha vai para `data-theme` no <html> e para um cookie, que o layout lê no
 * servidor — assim a próxima carga já vem no tema certo, sem piscar.
 */
export function AlternarTema({ inicial }: { inicial: Tema | null }) {
  const [tema, setTema] = useState<Tema | null>(inicial);

  // Sem escolha salva, descobre o tema que o sistema está aplicando agora.
  useEffect(() => {
    if (tema) return;
    setTema(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, [tema]);

  const escuro = tema === 'dark';

  function alternar() {
    const proximo: Tema = escuro ? 'light' : 'dark';
    document.documentElement.dataset['theme'] = proximo;
    document.cookie = `tema=${proximo}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setTema(proximo);
  }

  return (
    <button
      type="button"
      className="tema"
      onClick={alternar}
      aria-label={escuro ? 'Usar modo claro' : 'Usar modo noturno'}
      title={escuro ? 'Modo claro' : 'Modo noturno'}
    >
      {escuro ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
