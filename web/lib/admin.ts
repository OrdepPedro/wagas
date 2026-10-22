/**
 * Cliente com a chave SECRETA. Só servidor, nunca navegador.
 *
 * A chave `sb_secret_…` ignora RLS: com ela dá para ler o acervo inteiro,
 * inclusive as linhas que o portão de local desativou, e escrever em qualquer
 * tabela. Ela existe aqui por um motivo específico e limitado — a coleta sob
 * demanda precisa GRAVAR em `raw_results` e `jobs`, e dar essa permissão à
 * chave pública deixaria qualquer visitante injetar vaga falsa no feed de todo
 * mundo.
 *
 * Duas proteções, porque uma só depende de eu não errar:
 *
 *   1. A variável não tem o prefixo `NEXT_PUBLIC_`, então o bundler nunca a
 *      injeta no código do cliente.
 *   2. A checagem abaixo estoura se este módulo for importado num componente de
 *      cliente por acidente — falha alta em desenvolvimento, em vez de silêncio
 *      em produção.
 */
import { SupabaseRest } from '../../src/db/supabase.ts';

let cliente: SupabaseRest | null = null;

export function clienteAdministrativo(): SupabaseRest {
  if (typeof window !== 'undefined') {
    throw new Error('clienteAdministrativo importado no navegador: a chave secreta não vai para lá');
  }

  if (cliente) return cliente;

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim();
  const chave = process.env['SUPABASE_SERVICE_KEY']?.trim();
  if (!url || !chave) {
    throw new Error('SUPABASE_SERVICE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente');
  }

  cliente = new SupabaseRest(url.replace(/\/+$/, ''), chave);
  return cliente;
}

/** A coleta sob demanda está configurada? Sem a chave, o feed só lê o cache. */
export function coletaSobDemandaDisponivel(): boolean {
  return Boolean(process.env['SUPABASE_SERVICE_KEY']?.trim());
}
