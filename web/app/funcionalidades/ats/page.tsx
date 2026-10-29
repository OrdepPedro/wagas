import { Medidor } from './medidor.tsx';

/** Uma chamada ao Gemini leva de 5 a 20 s; com uma retentativa, até um minuto. */
export const maxDuration = 60;

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
