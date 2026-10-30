import { Estruturador } from './estruturador.tsx';

/** Uma chamada ao Gemini leva de 5 a 20 s; com uma retentativa, até um minuto. */
export const maxDuration = 60;

export default function PaginaDoEstruturador() {
  return (
    <div className="funcionalidades medidor-pagina">
      <section className="hero hero-ats">
        <h1>
          Currículo pronto para <mark>LinkedIn e Gupy</mark>
        </h1>
        <p className="hero-sub">
          Envie o seu currículo, escolha a plataforma e receba cada campo reescrito do jeito que ela lê, pronto
          para colar. Sem inventar nada que não esteja no seu histórico.
        </p>
        <Estruturador />
      </section>
    </div>
  );
}
