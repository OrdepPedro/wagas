import { clienteDoServidor, type Usuario } from '../../lib/supabase.ts';
import { desligarEmailSemanal, ligarEmailSemanal } from './actions.ts';

/**
 * O convite do e-mail semanal em Minhas vagas: uma linha de texto que liga ou
 * desliga o envio. As buscas extras se configuram no Mapa (aba Alertas).
 *
 * Discreto de propósito: é um recurso a mais, não o caminho principal da tela.
 * Mesmo numa linha, o texto diz o que chega, para qual e-mail e com que
 * frequência ANTES do clique, porque o clique é o consentimento (LGPD).
 *
 * Visitante anônimo não tem e-mail: o convite leva a entrar.
 * Sem a migration 0025, a leitura falha e a linha some: a tela segue igual.
 */
export async function AlertaPorEmail({ usuario, cargo }: { usuario: Usuario; cargo: string }) {
  if (usuario.visitante) {
    return (
      <p className="fraco alerta-email">
        Vagas novas de {cargo} no seu e-mail, toda segunda: <a href="/entrar">entre com seu e-mail</a>.
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
        Vagas novas de {cargo} chegam em {usuario.email} toda segunda.{' '}
        <button type="submit" className="como-link">
          Parar
        </button>
        {' · '}
        <a href="/mapa?aba=alertas">mais buscas no e-mail</a>
      </form>
    );
  }

  return (
    <form action={ligarEmailSemanal} className="fraco alerta-email">
      <button type="submit" className="como-link">
        Receber as vagas novas de {cargo} por e-mail
      </button>{' '}
      — toda segunda, em {usuario.email}, só quando houver vaga nova.
    </form>
  );
}
