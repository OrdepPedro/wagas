import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { LIMITE_GRATUITO } from '../lib/limites.ts';
import { lerPerfil } from '../lib/perfil.ts';
import { URL_DO_SITE } from '../lib/site.ts';
import { usuarioAtual } from '../lib/supabase.ts';
import { BotaoEntrar } from './entrar-modal.tsx';
import { Marca } from './marca.tsx';
import { MenuFuncionalidades } from './menu-funcionalidades.tsx';
import { AlternarTema } from './tema.tsx';
import './globals.css';

const DESCRICAO =
  'Vagas de emprego publicadas nos últimos 7 dias para o seu cargo e a sua cidade, mais vagas remotas de todo o Brasil. Gupy, InfoJobs e LinkedIn num lugar só, grátis e sem cadastro.';

/**
 * Título e descrição dizem o que a pessoa digita no Google ("vagas de
 * emprego", "vagas remotas"), não só a marca: "wagas" sozinho não é buscado
 * por ninguém que ainda não conhece o site.
 */
export const metadata: Metadata = {
  metadataBase: new URL(URL_DO_SITE),
  title: {
    default: 'wagas — vagas de emprego publicadas nesta semana',
    template: '%s · wagas',
  },
  description: DESCRICAO,
  // Sem `alternates.canonical` aqui: o layout é herdado, e um canonical '/'
  // diria ao Google que toda página é cópia da home. Cada página declara o seu.
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'wagas',
    url: '/',
    title: 'wagas — vagas de emprego publicadas nesta semana',
    description: DESCRICAO,
  },
  twitter: { card: 'summary_large_image' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Lido no servidor para o HTML já sair no tema escolhido. Sem cookie, o CSS
  // segue o sistema (prefers-color-scheme).
  const salvo = (await cookies()).get('tema')?.value;
  const tema = salvo === 'dark' || salvo === 'light' ? salvo : null;

  // "Minhas vagas" só para quem já tem busca salva; para os outros, o link
  // levaria de volta à própria landing.
  const usuario = await usuarioAtual().catch(() => null);
  const temFeed = usuario ? Boolean(await lerPerfil(usuario.id).catch(() => null)) : false;
  // Visitante anônimo também vê "Entrar": é por aqui que quem já tem conta volta
  // a ela em outro navegador.
  const entrou = Boolean(usuario && !usuario.visitante);

  return (
    <html lang="pt-BR" suppressHydrationWarning {...(tema ? { 'data-theme': tema } : {})}>
      <body>
        <header className="topo">
          <div className="topo-interno">
            <a href="/" className="marca" aria-label="wagas, início">
              <Marca />
            </a>
            <nav className="topo-centro" aria-label="Funcionalidades">
              <MenuFuncionalidades />
            </nav>
            <nav className="topo-acoes">
              {temFeed ? (
                <a href="/vagas" className="link-feed">
                  Minhas vagas
                </a>
              ) : null}
              {entrou ? null : <BotaoEntrar limite={LIMITE_GRATUITO} />}
              <AlternarTema inicial={tema} />
            </nav>
          </div>
        </header>
        <main>{children}</main>
        {/* Contagem de páginas da Vercel: sem cookie, e só envia em produção. */}
        <Analytics />
      </body>
    </html>
  );
}
