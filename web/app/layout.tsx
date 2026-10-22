import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'wagas',
  description: 'Vagas dos últimos 7 dias para o seu cargo e a sua cidade.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
