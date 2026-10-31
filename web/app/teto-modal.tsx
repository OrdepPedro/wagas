'use client';

import { useEffect, useRef, useState } from 'react';
import { FormularioDeEntrada } from './formularios.tsx';

/**
 * Teto do visitante estourado: abre sozinho, no mesmo modal do "Entrar" do
 * cabeçalho, porque o próximo passo é um só (entrar com e-mail) e no meio do
 * feed ele disputava espaço com a busca.
 *
 * Fechar não apaga o aviso: sobra uma linha explicando por que o feed é só do
 * acervo, com o caminho para reabrir. Sem ela, quem fecha o modal vê vagas
 * velhas sem saber por quê.
 */
export function AvisoDeTeto({ teto, detalhe }: { teto: number; detalhe: string }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [aberto, setAberto] = useState(true);

  useEffect(() => {
    dialogo.current?.showModal();
  }, []);

  function abrir() {
    setAberto(true);
    dialogo.current?.showModal();
  }

  function fechar() {
    dialogo.current?.close();
  }

  return (
    <>
      <p className="fraco teto-linha">
        Você já usou as {teto} buscas de visitante. Estas vagas são só do que já estava no nosso
        acervo.{' '}
        <button type="button" className="discreto" onClick={abrir}>
          Entrar com e-mail
        </button>
      </p>
      <dialog
        ref={dialogo}
        className="modal-entrar"
        aria-labelledby="modal-teto-titulo"
        onClose={() => setAberto(false)}
        // Clique no fundo escurecido fecha; clique dentro da caixa, não.
        onClick={(evento) => {
          if (evento.target === evento.currentTarget) fechar();
        }}
      >
        {aberto ? (
          <div className="modal-entrar-corpo">
            <button type="button" className="modal-fechar" onClick={fechar} aria-label="Fechar">
              ×
            </button>
            <h2 id="modal-teto-titulo">Suas {teto} buscas de visitante acabaram</h2>
            <p className="fraco">
              As vagas abaixo são só do que já estava no nosso acervo. {detalhe}
            </p>
            <FormularioDeEntrada />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
