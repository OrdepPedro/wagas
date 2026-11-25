import type { Metadata } from 'next';
import { cidadeDoFormulario, lerPerfil } from '../lib/perfil.ts';
import { URL_DO_SITE } from '../lib/site.ts';
import { usuarioAtual } from '../lib/supabase.ts';
import { carregarVitrine } from '../lib/vitrine.ts';
import { carregarCargosAbrangidos } from '../lib/cargos.ts';
import { FormularioDeBusca } from './formularios.tsx';
import { Landing } from './landing.tsx';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/**
 * Dados estruturados: diz ao Google o nome do site (o que aparece acima do
 * link no resultado) e que ele é um aplicativo web gratuito em português.
 */
const DADOS_ESTRUTURADOS = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      name: 'wagas',
      url: `${URL_DO_SITE}/`,
      inLanguage: 'pt-BR',
    },
    {
      '@type': 'WebApplication',
      name: 'wagas',
      url: `${URL_DO_SITE}/`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'pt-BR',
      description:
        'Vagas de emprego publicadas nos últimos 7 dias para o seu cargo e a sua cidade, mais vagas remotas de todo o Brasil.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
    },
  ],
};

function JsonLd() {
  return (
    <script
      type="application/ld+json"
      // Conteúdo fixo, sem dado de usuário: não há o que escapar.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(DADOS_ESTRUTURADOS) }}
    />
  );
}

/**
 * `/` é sempre a landing, para qualquer pessoa — inclusive quem já tem busca
 * salva. O feed mora em `/vagas`, e o cabeçalho leva até ele.
 */
export default async function Pagina() {
  const usuario = await usuarioAtual();

  // Sem sessão é o caso de todo visitante novo, e também o do robô de busca: a
  // sessão anônima só nasce quando a pessoa busca (`usuarioOuVisitante`). A
  // landing é a mesma; quem já buscou chega com o formulário preenchido. A
  // leitura da vitrine sem sessão passa pela policy `jobs_leitura_publica` (0021).
  const [perfil, vitrine, cargos] = await Promise.all([
    usuario ? lerPerfil(usuario.id) : Promise.resolve(null),
    carregarVitrine(),
    carregarCargosAbrangidos(),
  ]);
  const formulario = perfil ? (
    <FormularioDeBusca
      hero
      cargo={perfil.cargo}
      cidade={cidadeDoFormulario(perfil)}
      soRemoto={perfil.soRemoto}
      rotulo="Ver vagas"
    />
  ) : undefined;

  return (
    <>
      <JsonLd />
      <Landing vitrine={vitrine} cargos={cargos} {...(formulario ? { formulario } : {})} />
    </>
  );
}
