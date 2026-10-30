'use client';

import { useRef, useState } from 'react';
import { FormularioDeEntrada } from './formularios.tsx';

/**
 * "Entrar" do cabeçalho: abre um modal na página em que a pessoa está, em vez
 * de levá-la para /entrar e fazê-la perder a busca ou o currículo da tela.
 *
 * Continua sendo um link para /entrar: sem JavaScript, ou com clique do meio,
 * cai na página. O formulário só é montado com o modal aberto, então cada
 * abertura começa limpa, sem o "mandei um link" da vez anterior.
 */
export function BotaoEntrar({ limite }: { limite: number }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [aberto, setAberto] = useState(false);

  function abrir(evento: React.MouseEvent<HTMLAnchorElement>) {
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.button !== 0) return;
    evento.preventDefault();
    setAberto(true);
    dialogo.current?.showModal();
  }

  function fechar() {
    dialogo.current?.close();
  }

  return (
    <>
      <a href="/entrar" className="link-entrar" onClick={abrir}>
        Entrar
      </a>
      <dialog
        ref={dialogo}
        className="modal-entrar"
        aria-labelledby="modal-entrar-titulo"
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
            <h2 id="modal-entrar-titulo">Entrar</h2>
            <p className="fraco">
              Mandamos um link para o seu e-mail — sem senha. Com e-mail, são {limite} buscas por
              dia.
            </p>
            <FormularioDeEntrada />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
