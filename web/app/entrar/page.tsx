import { redirect } from 'next/navigation';
import { LIMITE_GRATUITO } from '../../lib/limites.ts';
import { usuarioAtual } from '../../lib/supabase.ts';
import { FormularioDeEntrada } from '../formularios.tsx';

export const dynamic = 'force-dynamic';

/**
 * Entrar com e-mail, para quem já tem conta.
 *
 * Antes, o campo de e-mail só aparecia quando o visitante esgotava as buscas —
 * quem voltava em outro navegador, ou depois de limpar os cookies, não tinha
 * como chegar à própria conta. Quem já entrou com e-mail não precisa desta tela.
 */
export default async function PaginaDeEntrar({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const usuario = await usuarioAtual();
  if (usuario && !usuario.visitante) redirect('/vagas');

  const { erro } = await searchParams;

  return (
    <div className="entrar">
      <h1>Entrar</h1>
      <p className="fraco">
        Mandamos um link para o seu e-mail — sem senha. Com e-mail, são {LIMITE_GRATUITO} buscas por
        dia.
      </p>
      {erro === 'link' ? (
        <p className="erro">
          Esse link não funcionou: ele vale por uma hora e precisa ser aberto no mesmo navegador.
          Peça um novo abaixo.
        </p>
      ) : null}
      <div className="caixa">
        <FormularioDeEntrada />
      </div>
    </div>
  );
}
