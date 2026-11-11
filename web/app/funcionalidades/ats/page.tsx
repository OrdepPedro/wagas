import type { Metadata } from 'next';
import { metadataDaPagina } from '../../../lib/site.ts';
import { Medidor } from './medidor.tsx';

export const metadata: Metadata = metadataDaPagina(
  '/funcionalidades/ats',
  'Medidor de currículo para ATS grátis — nota de 0 a 100',
  'Envie seu currículo em PDF ou Word e receba uma nota de 0 a 100: se os sistemas de recrutamento (ATS) conseguem lê-lo, se mostra o que o cargo pede e o que mais aumenta suas chances.',
);

/** Uma chamada ao Gemini leva de 5 a 20 s; com uma retentativa, até um minuto. */
export const maxDuration = 120;

export default function PaginaDoMedidor() {
  return (
    <div className="funcionalidades medidor-pagina">
      <section className="hero hero-ats">
        <h1>
          Medidor de currículo <mark>para ATS</mark>
        </h1>
        <p className="hero-sub">
          Envie o seu currículo e receba uma nota de 0 a 100, com o que mais aumenta as suas chances: se os
          sistemas de recrutamento conseguem lê-lo, se ele mostra o que o cargo pede e se convence quem lê.
        </p>
        <Medidor />
      </section>
    </div>
  );
}
