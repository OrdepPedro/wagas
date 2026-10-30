import { cidadeDoFormulario, lerPerfil } from '../lib/perfil.ts';
import { usuarioAtual } from '../lib/supabase.ts';
import { carregarVitrine } from '../lib/vitrine.ts';
import { FormularioDeBusca, FormularioDeEntrada } from './formularios.tsx';
import { Landing } from './landing.tsx';

export const dynamic = 'force-dynamic';

/**
 * `/` é sempre a landing, para qualquer pessoa — inclusive quem já tem busca
 * salva. O feed mora em `/vagas`, e o cabeçalho leva até ele.
 */
export default async function Pagina() {
  const usuario = await usuarioAtual();

  // Sem sessão só acontece se os logins anônimos estiverem desligados no
  // Supabase: aí a landing pede e-mail no lugar da busca.
  if (!usuario) return <Landing formulario={<FormularioDeEntrada />} />;

  // Quem já buscou chega com o formulário preenchido com a última busca.
  const [perfil, vitrine] = await Promise.all([lerPerfil(usuario.id), carregarVitrine()]);
  const formulario = perfil ? (
    <FormularioDeBusca
      hero
      cargo={perfil.cargo}
      cidade={cidadeDoFormulario(perfil)}
      soRemoto={perfil.soRemoto}
      rotulo="Ver vagas"
    />
  ) : undefined;

  return <Landing vitrine={vitrine} {...(formulario ? { formulario } : {})} />;
}
