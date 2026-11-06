/**
 * Tranca comum das rotas `/api/extensao/*`.
 *
 * A extensão chama o site com o cookie de sessão da pessoa (`credentials:
 * 'include'`): ela não guarda token nenhum, e quem não está logado no site é
 * mandado para o site. Por isso a origem é conferida em toda rota — só a
 * extensão (fixada por `EXTENSAO_ID` em produção) e o próprio site.
 */
import { NextResponse } from 'next/server';
import { CABECALHO_EXTENSAO, chamadaPermitida, origemPermitida } from '../../src/curriculo/vaga-colada.ts';

const SITE = (): string => process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000';
const ID = (): string | undefined => process.env['EXTENSAO_ID']?.trim() || undefined;

function cabecalhos(origem: string | null): Record<string, string> {
  return {
    ...(origem
      ? {
          'access-control-allow-origin': origem,
          'access-control-allow-credentials': 'true',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': `content-type, ${CABECALHO_EXTENSAO}`,
        }
      : {}),
    vary: 'origin',
    // CV é dado pessoal: nada de cache no caminho.
    'cache-control': 'private, no-store',
  };
}

/** `null` quando o pedido não pode chamar; senão, os cabeçalhos da resposta. */
export function conferirOrigem(requisicao: Request): Record<string, string> | null {
  const origem = requisicao.headers.get('origin');
  if (!chamadaPermitida(origem, requisicao.headers.get(CABECALHO_EXTENSAO), SITE(), ID())) return null;
  return cabecalhos(origem);
}

/** Preflight não traz o cabeçalho próprio (só o anuncia): aqui a origem decide. */
function conferirPreflight(requisicao: Request): Record<string, string> | null {
  const origem = requisicao.headers.get('origin');
  return origemPermitida(origem, SITE(), ID()) ? cabecalhos(origem) : null;
}

export function recusada(): NextResponse {
  return NextResponse.json({ erro: 'origem não permitida' }, { status: 403 });
}

export function json(corpo: unknown, h: Record<string, string>, status = 200): NextResponse {
  return NextResponse.json(corpo, { status, headers: h });
}

export function preflight(requisicao: Request): NextResponse {
  const h = conferirPreflight(requisicao);
  return h ? new NextResponse(null, { status: 204, headers: h }) : recusada();
}

export const URL_DO_SITE = SITE;
