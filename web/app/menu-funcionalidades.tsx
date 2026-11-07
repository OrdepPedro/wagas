'use client';

import { useEffect, useRef, useState } from 'react';
import { URL_EXTENSAO } from './extensao-chrome.tsx';

type Item = { href: string; titulo: string; descricao: string; icone: string; externo?: boolean };

const SECOES: { titulo: string; itens: Item[] }[] = [
  {
    titulo: 'Ferramentas de busca',
    itens: [
      {
        href: '/funcionalidades/dorks',
        titulo: 'Gerador de buscas avançadas',
        descricao: 'Monte a busca do Google por cargo, sites e período, pronta para abrir.',
        icone: 'busca',
      },
    ],
  },
  {
    titulo: 'Currículo',
    itens: [
      {
        href: '/funcionalidades/ats',
        titulo: 'Medidor de currículo para ATS',
        descricao: 'Veja se sistemas de recrutamento leem seu currículo e o que falta para o cargo.',
        icone: 'documento',
      },
      {
        href: '/funcionalidades/estruturar',
        titulo: 'Currículo para LinkedIn e Gupy',
        descricao: 'Receba cada campo do perfil reescrito do jeito que a plataforma lê, pronto para colar.',
        icone: 'perfil',
      },
      {
        href: '/curriculo',
        titulo: 'Currículo adaptado à vaga',
        descricao: 'Guarde seu currículo uma vez e a IA o reescreve para cada vaga do feed, em PDF.',
        icone: 'adaptar',
      },
      {
        href: URL_EXTENSAO,
        titulo: 'Extensão para Chrome',
        descricao: 'Adapte o currículo a uma vaga de qualquer site, num painel ao lado da página.',
        icone: 'extensao',
        externo: true,
      },
    ],
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
          {SECOES.map((secao) => (
            <div key={secao.titulo}>
              <p className="menu-func-secao">{secao.titulo}</p>
              {secao.itens.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="menu-func-item"
                  onClick={() => setAberto(false)}
                  {...(item.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  <span className="menu-func-icone" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {item.icone === 'busca' ? (
                        <>
                          <circle cx="11" cy="11" r="7" />
                          <path d="m20 20-3.5-3.5" />
                          <path d="m8.5 11 1.75 1.75L13.5 9.5" />
                        </>
                      ) : item.icone === 'perfil' ? (
                        <>
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <circle cx="9" cy="10" r="2" />
                          <path d="M6 16a3 3 0 0 1 6 0" />
                          <path d="M15 9h3M15 13h3" />
                        </>
                      ) : item.icone === 'extensao' ? (
                        <>
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <path d="M3 9h18" />
                          <path d="M15 9v11" />
                          <path d="M17.5 13h1.5M17.5 16h1.5" />
                        </>
                      ) : item.icone === 'adaptar' ? (
                        <>
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                          <path d="M14 3v5h5" />
                          <path d="M9 13h6M9 17h3" />
                          <path d="m16.5 15.5 1 1 2-2" />
                        </>
                      ) : (
                        <>
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                          <path d="M14 3v5h5" />
                          <path d="m9 14 2 2 4-4" />
                        </>
                      )}
                    </svg>
                  </span>
                  <span>
                    <strong>{item.titulo}</strong>
                    <span className="menu-func-desc">{item.descricao}</span>
                  </span>
                </a>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
