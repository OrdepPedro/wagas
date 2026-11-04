'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { sugerirCargo, type EstadoDaSugestao } from './actions.ts';

/**
 * Faixa logo abaixo do hero: os cargos que a coleta diária cobre, rolando
 * sozinhos, e um botão que abre a lista inteira num modal com a opção de
 * sugerir mais.
 *
 * O carrossel é CSS puro (a faixa é duplicada e desliza meia largura, então o
 * laço não tem emenda). A velocidade é fixa em px/s, não em duração total: com
 * 10 cargos ou com 80, cada nome passa no mesmo ritmo de leitura.
 */
const PX_POR_SEGUNDO = 55;

export function CargosAbrangidos({ cargos }: { cargos: string[] }) {
  const trilho = useRef<HTMLUListElement>(null);
  const [duracao, setDuracao] = useState(cargos.length * 3);
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    // Meia largura do trilho = uma volta (o trilho tem a lista duas vezes).
    const largura = (trilho.current?.scrollWidth ?? 0) / 2;
    if (largura > 0) setDuracao(largura / PX_POR_SEGUNDO);
  }, [cargos]);

  const itens = [...cargos, 'muito mais…'];

  return (
    <section className="abrangidos" aria-labelledby="abrangidos-titulo">
      <p className="sobretitulo" id="abrangidos-titulo">
        Cargos que coletamos todo dia
      </p>

      <div className="carrossel">
        <ul
          ref={trilho}
          className="carrossel-trilho"
          style={{ animationDuration: `${duracao}s` }}
          aria-label="Cargos cobertos"
        >
          {[0, 1].map((volta) =>
            itens.map((cargo, i) => (
              <li
                key={`${volta}-${i}`}
                className={i === cargos.length ? 'mais' : undefined}
                aria-hidden={volta === 1 ? true : undefined}
              >
                {cargo}
              </li>
            )),
          )}
        </ul>
      </div>

      <button
        type="button"
        className="botao-secundario"
        onClick={() => dialogo.current?.showModal()}
      >
        Ver todos os cargos abrangidos
      </button>

      <dialog
        ref={dialogo}
        className="modal"
        aria-labelledby="modal-cargos-titulo"
        // Clique no fundo (fora da caixa) fecha.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="modal-caixa">
          <div className="modal-cabecalho">
            <h2 id="modal-cargos-titulo">Cargos abrangidos</h2>
            <button
              type="button"
              className="modal-fechar"
              aria-label="Fechar"
              onClick={() => dialogo.current?.close()}
            >
              ×
            </button>
          </div>
          <p className="fraco">
            Coletados todo dia nas capitais, mais as vagas remotas de todo o Brasil. A busca aceita
            qualquer cargo — estes são os que já chegam com o cache cheio.
          </p>
          <ListaESugestao cargos={cargos} />
        </div>
      </dialog>
    </section>
  );
}

const VAZIO: EstadoDaSugestao = {};

function ListaESugestao({ cargos }: { cargos: string[] }) {
  const [estado, acao] = useActionState(sugerirCargo, VAZIO);
  const [sugeridos, setSugeridos] = useState<string[]>([]);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.aceito) {
      setSugeridos((s) => (s.includes(estado.aceito!) ? s : [...s, estado.aceito!]));
      form.current?.reset();
    }
  }, [estado]);

  const ordenados = [...cargos].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return (
    <>
      <ul className="modal-lista">
        {ordenados.map((c) => (
          <li key={c}>{c}</li>
        ))}
        {sugeridos.map((c) => (
          <li key={`novo-${c}`} className="novo">
            {c} <small>na fila</small>
          </li>
        ))}
      </ul>

      <form ref={form} action={acao} className="modal-sugestao">
        <label htmlFor="cargo-sugerido">Não achou o seu? Sugira um cargo</label>
        <div className="linha">
          <input
            id="cargo-sugerido"
            name="cargo"
            type="text"
            required
            minLength={3}
            maxLength={60}
            placeholder="Ex.: Garçom, Eletricista"
            autoComplete="off"
          />
          <Enviar />
        </div>
        {estado.erro ? <p className="erro">{estado.erro}</p> : null}
        {estado.aceito ? (
          <p className="ok">
            <strong>{estado.aceito}</strong> entra na coleta da próxima madrugada e aparece aqui
            quando encontrarmos vagas.
          </p>
        ) : null}
        {estado.jaCoberto ? (
          <p className="fraco">
            <strong>{estado.jaCoberto}</strong> já está coberto ou na fila de coleta.
          </p>
        ) : null}
      </form>
    </>
  );
}

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Enviando…' : 'Sugerir'}
    </button>
  );
}
