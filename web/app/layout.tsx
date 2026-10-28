import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { lerPerfil } from '../lib/perfil.ts';
import { usuarioAtual } from '../lib/supabase.ts';
import { MenuFuncionalidades } from './menu-funcionalidades.tsx';
import { AlternarTema } from './tema.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: 'wagas',
  description: 'Vagas dos últimos 7 dias para o seu cargo e a sua cidade.',
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
              <span className="marca-icone" aria-hidden="true">
                w
              </span>
              <span className="marca-nome">wagas</span>
            </a>
            <nav className="topo-acoes">
              <MenuFuncionalidades />
              {temFeed ? (
                <a href="/vagas" className="link-feed">
                  Minhas vagas
                </a>
              ) : null}
              {entrou ? null : (
                <a href="/entrar" className="link-entrar">
                  Entrar
                </a>
              )}
              <AlternarTema inicial={tema} />
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
