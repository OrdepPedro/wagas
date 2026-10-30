/**
 * O perfil é o par cargo × cidade do usuário.
 *
 * Singular de propósito: a premissa do produto é "o usuário informa cargo e
 * cidade", e várias buscas por pessoa é desenho de tier pago, que ainda não
 * existe. Guardar o par é o que faz o feed existir na segunda visita — e sem
 * segunda visita não há retenção no dia 7 para medir.
 */
import { slugCidade } from '../../src/normalize/local.ts';
import { clienteDoServidor } from './supabase.ts';

export interface Perfil {
  cargo: string;
  cidade: string;
  cidadeSlug: string;
  /** true = feed só com remoto do Brasil inteiro; a cidade deixa de filtrar. */
  soRemoto: boolean;
}

export async function lerPerfil(userId: string): Promise<Perfil | null> {
  const supabase = await clienteDoServidor();
  const { data } = await supabase
    .from('perfis')
    .select('cargo,cidade,cidade_slug,so_remoto')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;
  return {
    cargo: data.cargo,
    cidade: data.cidade,
    cidadeSlug: data.cidade_slug,
    soRemoto: Boolean(data.so_remoto),
  };
}

/**
 * O que se grava em `perfis.cidade` quando a pessoa pede só remoto e não diz
 * cidade. A coluna é `not null` com 2 a 80 caracteres, e com `so_remoto` a
 * cidade não filtra nada — o valor só precisa existir e ler bem onde aparece
 * (buscas salvas, `buscas.cidade`). O formulário o mostra como campo vazio.
 */
export const CIDADE_SO_REMOTO = 'Todo o Brasil';

/** A cidade como o formulário deve exibir: o sentinela vira campo vazio. */
export function cidadeDoFormulario(perfil: Perfil): string {
  return perfil.cidade === CIDADE_SO_REMOTO ? '' : perfil.cidade;
}

export interface ErroDePerfil {
  campo: 'cargo' | 'cidade';
  mensagem: string;
}

/**
 * Valida e grava.
 *
 * O slug é calculado aqui, com a MESMA função que o classificador usou para
 * preencher `jobs.cidade_slug`. Se o Postgres derivasse o slug por conta
 * própria, as duas normalizações poderiam discordar — e o sintoma seria feed
 * vazio para uma cidade que está no acervo.
 */
export async function salvarPerfil(
  userId: string,
  cargoBruto: string,
  cidadeBruta: string,
  soRemoto = false,
): Promise<ErroDePerfil | null> {
  const cargo = cargoBruto.trim().replace(/\s+/g, ' ');
  let cidade = cidadeBruta.trim().replace(/\s+/g, ' ');

  // Só remoto dispensa a cidade. E o caminho inverso também vale: as buscas
  // salvas do visitante reenviam só cargo e cidade, sem a opção — o sentinela
  // é o que lembra que aquela busca era remota.
  if (soRemoto && cidade === '') cidade = CIDADE_SO_REMOTO;
  if (cidade === CIDADE_SO_REMOTO) soRemoto = true;

  if (cargo.length < 2) return { campo: 'cargo', mensagem: 'Escreva o cargo que você procura.' };
  if (cargo.length > 80) return { campo: 'cargo', mensagem: 'Cargo longo demais.' };
  if (cidade.length < 2) {
    return { campo: 'cidade', mensagem: 'Escreva a sua cidade ou marque "Só vagas remotas".' };
  }
  if (cidade.length > 80) return { campo: 'cidade', mensagem: 'Cidade longa demais.' };

  const cidadeSlug = slugCidade(cidade);
  if (cidadeSlug === '') return { campo: 'cidade', mensagem: 'Não entendi essa cidade.' };

  const supabase = await clienteDoServidor();
  const { error } = await supabase.from('perfis').upsert(
    {
      user_id: userId,
      cargo,
      cidade,
      cidade_slug: cidadeSlug,
      so_remoto: soRemoto,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) return { campo: 'cargo', mensagem: 'Não consegui salvar. Tente de novo.' };
  return null;
}
