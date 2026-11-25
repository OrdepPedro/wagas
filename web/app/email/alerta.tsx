import { clienteDoServidor, type Usuario } from '../../lib/supabase.ts';
import { desligarEmailSemanal, ligarEmailSemanal } from './actions.ts';

/**
 * O convite do e-mail semanal, logo abaixo da busca.
 *
 * Visitante anônimo não tem e-mail: o convite leva a entrar. Com conta, é um
 * botão só, e o texto diz o que vai chegar e como parar, antes do clique.
 *
 * Sem a migration 0025, a leitura falha e o bloco some: o feed segue igual.
 */
export async function AlertaPorEmail({ usuario, cargo }: { usuario: Usuario; cargo: string }) {
  if (usuario.visitante) {
    return (
      <p className="fraco alerta-email">
        Quer as vagas novas de {cargo} no seu e-mail, toda segunda?{' '}
        <a href="/entrar">Entre com seu e-mail</a>.
      </p>
    );
  }

  const supabase = await clienteDoServidor();
  const { data, error } = await supabase
    .from('alertas_email')
    .select('ativo')
    .eq('user_id', usuario.id)
    .maybeSingle();
  if (error) return null;

  if (data?.ativo) {
    return (
      <form action={desligarEmailSemanal} className="fraco alerta-email">
        Toda segunda, as vagas novas de {cargo} chegam em {usuario.email}.{' '}
        <button type="submit" className="discreto">
          Parar de receber
        </button>
      </form>
    );
  }

  return (
    <form action={ligarEmailSemanal} className="caixa alerta-email">
      <p style={{ margin: '0 0 8px' }}>
        Receba as vagas novas de {cargo} em {usuario.email}, toda segunda.
      </p>
      <p className="fraco" style={{ margin: '0 0 12px' }}>
        Só quando houver vaga nova. Usamos o e-mail só para isso, e cada envio tem o link para parar.
      </p>
      <button type="submit">Quero receber</button>
    </form>
  );
}
