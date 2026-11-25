// E-mail semanal de vagas novas (Passo 5). Roda no Actions, toda segunda.
//
//   npm run email-semanal -- --seco                 monta tudo, não envia, grava as prévias em HTML
//   npm run email-semanal -- --para=voce@exemplo    envia só para esse endereço (teste), sem registrar
//   npm run email-semanal                           envia de verdade
//
// Lê só o cache (regra crítica do CLAUDE.md): nenhuma fonte externa é chamada
// aqui. A consulta é a MESMA do feed (`consultaDeFeed` + `colapsarRepetidas`):
// se o e-mail mostrasse vaga que a tela não mostra, a pessoa clicaria e não
// acharia, que é o jeito mais rápido de ensinar a ignorar o e-mail.

import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';
import { consultaDeFeed } from '../src/feed/consulta.ts';
import { colapsarRepetidas, type VagaColapsavel } from '../src/feed/colapsar.ts';
import { inicioDaSemana, montarEmail, vagasNovas, type VagaDoEmail } from '../src/email/semanal.ts';

const args = process.argv.slice(2);
const SECO = args.includes('--seco');
const PARA = args.find((a) => a.startsWith('--para='))?.slice('--para='.length) ?? null;
const LIMITE = Number(args.find((a) => a.startsWith('--limite='))?.slice('--limite='.length) ?? 80);

// O plano gratuito do Resend manda 100 por dia, e o link mágico do login sai
// da mesma conta. 80 deixa 20 para quem for entrar no dia do envio.
const SITE = (process.env['SITE_URL'] ?? 'https://www.wagas.com.br').replace(/\/+$/, '');
const REMETENTE = process.env['EMAIL_REMETENTE'] ?? 'wagas <vagas@wagas.com.br>';
// Rodar duas vezes na mesma semana (re-run do Actions) não pode mandar dois e-mails.
const INTERVALO_MINIMO_MS = 6 * 86_400_000;

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);
const resendKey = process.env['RESEND_KEY']?.trim();
if (!SECO && !resendKey) {
  console.error('RESEND_KEY ausente. Use --seco para montar sem enviar.');
  process.exit(1);
}

interface Alerta { user_id: string; descadastro: string }
interface Perfil { user_id: string; cargo: string; cidade: string; so_remoto: boolean }
interface Envio { user_id: string; enviado_em: string }
type Vaga = VagaDoEmail & VagaColapsavel;

async function emailDe(userId: string): Promise<string | null> {
  const r = await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: config.supabaseServiceKey, authorization: `Bearer ${config.supabaseServiceKey}` },
  });
  if (!r.ok) return null;
  const u = (await r.json()) as { email?: string | null; is_anonymous?: boolean };
  return u.is_anonymous ? null : (u.email ?? null);
}

async function enviar(para: string, assunto: string, html: string, texto: string, descadastro: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: REMETENTE,
      to: [para],
      subject: assunto,
      html,
      text: texto,
      // Descadastro de um clique (Gmail e Yahoo exigem para remetente em volume).
      headers: { 'List-Unsubscribe': `<${descadastro}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  const corpo = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok) throw new Error(`Resend ${r.status}: ${corpo.message ?? ''}`);
  return corpo.id ?? null;
}

const agora = new Date();
const alertas = await db.selectTodos<Alerta>('alertas_email', 'select=user_id,descadastro&ativo=is.true&order=user_id');
const ids = alertas.map((a) => a.user_id);
const perfis = ids.length
  ? await db.select<Perfil>('perfis', `select=user_id,cargo,cidade,so_remoto&user_id=in.(${ids.join(',')})`)
  : [];
const envios = ids.length
  ? await db.select<Envio>('envios_email', `select=user_id,enviado_em&user_id=in.(${ids.join(',')})&order=enviado_em.desc`)
  : [];
const perfilDe = new Map(perfis.map((p) => [p.user_id, p]));
const ultimoEnvio = new Map<string, string>();
for (const e of envios) if (!ultimoEnvio.has(e.user_id)) ultimoEnvio.set(e.user_id, e.enviado_em);

const conta = { alertas: alertas.length, enviados: 0, semPerfil: 0, semEmail: 0, semNovas: 0, jaRecebeu: 0, falhas: 0, noLimite: 0 };
if (SECO) mkdirSync('email-previas', { recursive: true });

for (const alerta of alertas) {
  const perfil = perfilDe.get(alerta.user_id);
  if (!perfil) { conta.semPerfil++; continue; }

  const ultimo = ultimoEnvio.get(alerta.user_id) ?? null;
  if (ultimo && agora.getTime() - new Date(ultimo).getTime() < INTERVALO_MINIMO_MS && !PARA) {
    conta.jaRecebeu++;
    continue;
  }

  const consulta = consultaDeFeed({ cargo: perfil.cargo, cidade: perfil.cidade, soRemoto: perfil.so_remoto, limite: 300, agora });
  const linhas = await db.select<Vaga>('jobs', consulta.query);
  const { mostrar, total } = vagasNovas(colapsarRepetidas(linhas).vagas, inicioDaSemana(ultimo, agora));
  // Sem vaga nova, não manda: e-mail vazio ensina a pessoa a não abrir o próximo.
  if (total === 0) { conta.semNovas++; continue; }

  if (conta.enviados >= LIMITE) { conta.noLimite++; continue; }

  const envioId = randomUUID();
  const email = montarEmail({
    cargo: perfil.cargo, cidade: perfil.cidade, soRemoto: perfil.so_remoto,
    vagas: mostrar, total, site: SITE, envioId, descadastro: alerta.descadastro,
  });

  if (SECO) {
    writeFileSync(`email-previas/${alerta.user_id}.html`, email.html);
    console.log(`[seco] ${perfil.cargo} / ${perfil.so_remoto ? 'remoto' : perfil.cidade}: ${total} novas, ${mostrar.length} no corpo`);
    conta.enviados++;
    continue;
  }

  const para = PARA ?? (await emailDe(alerta.user_id));
  if (!para) { conta.semEmail++; continue; }

  try {
    const resendId = await enviar(para, email.assunto, email.html, email.texto, email.linkDescadastro);
    // Envio de teste (--para) não entra na métrica nem conta como "já recebeu".
    if (!PARA) {
      await db.insert('envios_email', [{
        id: envioId, user_id: alerta.user_id, enviado_em: agora.toISOString(), cargo: perfil.cargo,
        cidade: perfil.cidade, so_remoto: perfil.so_remoto, vagas: total, job_ids: mostrar.map((v) => v.id), resend_id: resendId,
      }]);
    }
    conta.enviados++;
    if (PARA) break;
  } catch (erro) {
    conta.falhas++;
    console.error(`falha no envio para ${alerta.user_id}: ${String(erro)}`);
  }
  // Resend gratuito: 2 requisições por segundo.
  await new Promise((r) => setTimeout(r, 600));
}

console.log(JSON.stringify(conta));
// Falhou mais da metade do que tentou enviar: o job fica vermelho e o GitHub avisa.
if (conta.falhas > 0 && conta.falhas >= conta.enviados) process.exit(1);
