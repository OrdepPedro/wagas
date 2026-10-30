import { NextResponse } from 'next/server';
import { avisoDoPedido, lerPedido } from '../../../../src/coleta/outra-fonte.ts';
import { clienteAdministrativo, coletaSobDemandaDisponivel } from '../../../lib/admin.ts';
import { lerPerfil } from '../../../lib/perfil.ts';
import { usuarioAtual } from '../../../lib/supabase.ts';

/**
 * Estado da coleta da outra fonte para a busca atual de quem pergunta.
 *
 * O par sai do perfil da sessão, nunca da query string: assim a rota só
 * responde sobre a busca da própria pessoa. Só lê; não conta como busca.
 */
export async function GET() {
  const usuario = await usuarioAtual();
  if (!usuario || !coletaSobDemandaDisponivel()) return NextResponse.json({ aviso: null });

  const perfil = await lerPerfil(usuario.id);
  if (!perfil || perfil.soRemoto) return NextResponse.json({ aviso: null });

  try {
    const pedido = await lerPedido(clienteAdministrativo(), perfil.cargo, perfil.cidade);
    return NextResponse.json(
      { aviso: avisoDoPedido(pedido, new Date()) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ aviso: null });
  }
}
