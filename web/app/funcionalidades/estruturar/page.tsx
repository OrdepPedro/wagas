import type { Metadata } from 'next';
import { metadataDaPagina } from '../../../lib/site.ts';
import { Estruturador } from './estruturador.tsx';

export const metadata: Metadata = metadataDaPagina(
  '/funcionalidades/estruturar',
  'Currículo para LinkedIn e Gupy — cada campo pronto para colar',
  'Envie seu currículo, escolha LinkedIn ou Gupy e receba cada campo reescrito do jeito que a plataforma lê, pronto para colar. Grátis, sem inventar nada que não esteja no seu histórico.',
);

/** Uma chamada ao Gemini leva de 5 a 20 s; com uma retentativa, até um minuto. */
export const maxDuration = 120;

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
