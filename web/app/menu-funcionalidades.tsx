'use client';

import { useEffect, useRef, useState } from 'react';

const ITENS = [
  {
    href: '/funcionalidades/dorks',
    titulo: 'Gerador de buscas avançadas',
    descricao: 'Monte a busca do Google por cargo, sites e período, pronta para abrir.',
  },
];

/**
 * Menu suspenso do cabeçalho. Abre no hover (CSS); o clique continua abrindo
 * para toque e teclado, e fecha com clique fora, Esc ou ao escolher um item.
 */
export function MenuFuncionalidades() {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  return (
    <div className={`menu-func${aberto ? ' aberto' : ''}`} ref={raiz}>
      <button
        type="button"
        className={`menu-func-botao${aberto ? ' aberto' : ''}`}
        aria-expanded={aberto}
        aria-haspopup="true"
        onClick={() => setAberto((a) => !a)}
      >
        Funcionalidades
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="menu-func-painel">
          <p className="menu-func-secao">Ferramentas de busca</p>
          {ITENS.map((item) => (
            <a key={item.href} href={item.href} className="menu-func-item" onClick={() => setAberto(false)}>
              <span className="menu-func-icone" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                  <path d="m8.5 11 1.75 1.75L13.5 9.5" />
                </svg>
              </span>
              <span>
                <strong>{item.titulo}</strong>
                <span className="menu-func-desc">{item.descricao}</span>
              </span>
            </a>
          ))}
      </div>
    </div>
  );
}
