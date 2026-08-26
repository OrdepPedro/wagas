'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { definirBusca, entrar, type EstadoDoFormulario } from './actions.ts';

const VAZIO: EstadoDoFormulario = {};

function Enviar({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Um instante…' : children}
    </button>
  );
}

export function FormularioDeEntrada() {
  const [estado, acao] = useActionState(entrar, VAZIO);

  if (estado.enviadoPara) {
    return (
      <div className="caixa boa">
        <p>
          Mandei um link para <strong>{estado.enviadoPara}</strong>.
        </p>
        <p className="fraco" style={{ margin: 0 }}>
          Abra o link no mesmo navegador. Ele vale por uma hora.
        </p>
      </div>
    );
  }

  return (
    <form action={acao}>
      <div className="campos">
        <div>
          <label htmlFor="email">Seu e-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="voce@exemplo.com"
          />
        </div>
      </div>
      {estado.erro ? <p className="erro">{estado.erro}</p> : null}
      <Enviar>Receber link de acesso</Enviar>
    </form>
  );
}

export function FormularioDeBusca({
  cargo = '',
  cidade = '',
  soRemoto = false,
  rotulo = 'Ver vagas',
}: {
  cargo?: string;
  cidade?: string;
  soRemoto?: boolean;
  rotulo?: string;
}) {
  const [estado, acao] = useActionState(definirBusca, VAZIO);

  return (
    <form action={acao}>
      <div className="campos duplo">
        <div>
          <label htmlFor="cargo">Cargo</label>
          <input
            id="cargo"
            name="cargo"
            type="text"
            required
            defaultValue={cargo}
            placeholder="Product Manager"
          />
        </div>
        <div>
          <label htmlFor="cidade">Cidade</label>
          <input
            id="cidade"
            name="cidade"
            type="text"
            required
            defaultValue={cidade}
            placeholder="São Paulo"
          />
        </div>
      </div>
      <label className="opcao">
        <input type="checkbox" name="soRemoto" defaultChecked={soRemoto} />
        <span>
          Só vagas remotas
          {/* Não é um filtro a mais sobre o feed normal: é outra composição.
              Ligado, a cidade deixa de valer e o feed passa a ser o Brasil
              inteiro. Dizer isso aqui evita a pergunta "cadê minhas vagas
              presenciais". */}
          <small>Ignora a cidade e busca em todo o Brasil.</small>
        </span>
      </label>
      {estado.erro ? <p className="erro">{estado.erro}</p> : null}
      <Enviar>{rotulo}</Enviar>
    </form>
  );
}
