/**
 * E-mail semanal de vagas novas — o gatilho de retorno do Passo 5.
 *
 * Por que existe: até 25/11, 29 pessoas buscaram e nenhuma voltou depois de 7
 * dias. Nada no produto chamava a pessoa de volta, então "retenção no dia 7"
 * media sobretudo se ela lembrou que o site existe. Este e-mail é o gatilho
 * mais barato: a mesma busca dela, só com o que entrou desde o último envio.
 *
 * Tudo aqui é puro (sem rede), para ser testado. Quem lê o banco e chama o
 * Resend é `scripts/email-semanal.ts`.
 */
import { JANELA_DIAS } from '../feed/consulta.ts';

export interface VagaDoEmail {
  id: number;
  empresa: string;
  cargo: string;
  modelo: 'remoto' | 'hibrido' | 'presencial' | null;
  localizacao: string | null;
  cidade_slug: string | null;
  data_publicacao: string | null;
  data_referencia: string;
  tipo_contrato: string | null;
}

/** Cartões no corpo do e-mail. O resto fica no feed, a um clique. */
export const VAGAS_NO_EMAIL = 10;

const DIA_MS = 86_400_000;

/**
 * A partir de quando uma vaga conta como "nova" para esta pessoa.
 *
 * Último envio, se houve; senão, a janela do feed. Nunca mais que 7 dias para
 * trás: vaga mais velha que isso já saiu do feed, e mandar link para ela seria
 * prometer o que a tela não mostra.
 */
export function inicioDaSemana(ultimoEnvio: string | null, agora: Date): Date {
  const piso = new Date(agora.getTime() - JANELA_DIAS * DIA_MS);
  if (!ultimoEnvio) return piso;
  const ultimo = new Date(ultimoEnvio);
  if (Number.isNaN(ultimo.getTime())) return piso;
  return ultimo > piso ? ultimo : piso;
}

/**
 * As vagas que entraram desde `desde`, na ordem do feed (mais nova primeiro).
 *
 * Recebe a lista JÁ colapsada (trava 5): o e-mail não pode mostrar duas vezes
 * a mesma vaga, pelo mesmo motivo que o feed não pode.
 */
export function vagasNovas<T extends VagaDoEmail>(
  vagas: T[],
  desde: Date,
): { mostrar: T[]; total: number } {
  const novas = vagas
    .filter((v) => new Date(v.data_referencia) >= desde)
    .sort((a, b) => b.data_referencia.localeCompare(a.data_referencia));
  return { mostrar: novas.slice(0, VAGAS_NO_EMAIL), total: novas.length };
}

export interface PedidoDoEmail {
  cargo: string;
  cidade: string;
  soRemoto: boolean;
  vagas: VagaDoEmail[];
  total: number;
  site: string;
  /** Id do envio: vai em cada link, para o clique vir do e-mail ser contado. */
  envioId: string;
  /** Token de descadastro (alertas_email.descadastro). */
  descadastro: string;
}

export interface EmailMontado {
  assunto: string;
  html: string;
  texto: string;
  linkDescadastro: string;
}

const MODELO: Record<string, string> = { remoto: 'Remoto', hibrido: 'Híbrido', presencial: 'Presencial' };

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Data dita com a procedência, como no cartão do feed: "publicada" só quando é. */
function quando(v: VagaDoEmail): string {
  const publicada = v.data_publicacao !== null;
  const d = new Date(publicada ? v.data_publicacao! : v.data_referencia);
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  return publicada ? `publicada em ${dia}` : `vista em ${dia}`;
}

function linhaDeDetalhe(v: VagaDoEmail): string {
  const empresa = v.empresa && v.empresa !== 'não identificada' ? v.empresa : null;
  const local = v.modelo === 'remoto' ? 'Remoto no Brasil' : v.localizacao;
  return [empresa, local, v.modelo && v.modelo !== 'remoto' ? MODELO[v.modelo] : null, v.tipo_contrato, quando(v)]
    .filter(Boolean)
    .join(' · ');
}

export function montarEmail(p: PedidoDoEmail): EmailMontado {
  const site = p.site.replace(/\/+$/, '');
  const onde = p.soRemoto ? 'remoto em todo o Brasil' : `${p.cidade} e remoto no Brasil`;
  const linkDescadastro = `${site}/email/descadastrar?t=${encodeURIComponent(p.descadastro)}`;
  const link = (id: number) => `${site}/ir/${id}?envio=${encodeURIComponent(p.envioId)}`;
  const mais = p.total - p.vagas.length;

  const assunto =
    p.total === 1
      ? `1 vaga nova de ${p.cargo} esta semana`
      : `${p.total} vagas novas de ${p.cargo} esta semana`;

  const itensHtml = p.vagas
    .map(
      (v) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb">
<a href="${escapar(link(v.id))}" style="font-size:16px;font-weight:600;color:#1d4ed8;text-decoration:none">${escapar(v.cargo)}</a>
<div style="font-size:14px;color:#4b5563;margin-top:4px">${escapar(linhaDeDetalhe(v))}</div>
</td></tr>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto">
<tr><td>
<p style="font-size:14px;color:#6b7280;margin:0 0 4px">wagas · ${escapar(onde)}</p>
<h1 style="font-size:20px;margin:0 0 16px">${escapar(assunto)}</h1>
</td></tr>
<tr><td><table role="presentation" width="100%">${itensHtml}</table></td></tr>
<tr><td style="padding-top:16px;font-size:14px">
${mais > 0 ? `<p style="margin:0 0 12px">E mais ${mais} no seu feed.</p>` : ''}
<a href="${escapar(site)}/vagas" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none">Ver todas no wagas</a>
</td></tr>
<tr><td style="padding-top:32px;font-size:12px;color:#6b7280">
Você recebe este e-mail porque pediu, no wagas, as vagas novas de ${escapar(p.cargo)} toda semana.
<a href="${escapar(linkDescadastro)}" style="color:#6b7280">Parar de receber</a>.
</td></tr>
</table>
</body></html>`;

  const texto = [
    `${assunto} — ${onde}`,
    '',
    ...p.vagas.flatMap((v) => [v.cargo, linhaDeDetalhe(v), link(v.id), '']),
    mais > 0 ? `E mais ${mais} no seu feed: ${site}/vagas` : `Seu feed: ${site}/vagas`,
    '',
    `Parar de receber: ${linkDescadastro}`,
  ].join('\n');

  return { assunto, html, texto, linkDescadastro };
}

/** Formato do id de envio e do token de descadastro: só uuid entra no banco. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
