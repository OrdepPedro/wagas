import type { Metadata } from 'next';
import { cookies } from 'next/headers';
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

  return (
    <html lang="pt-BR" suppressHydrationWarning {...(tema ? { 'data-theme': tema } : {})}>
      <body>
        <header className="topo">
          <div className="topo-interno">
            <a href="/" className="marca" aria-label="wagas, início">
              <span className="marca-icone" aria-hidden="true">
                w
              </span>
              wagas
            </a>
            <AlternarTema inicial={tema} />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
