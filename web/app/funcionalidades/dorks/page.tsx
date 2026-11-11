import type { Metadata } from 'next';
import { metadataDaPagina } from '../../../lib/site.ts';
import { GeradorDeDorks } from './gerador.tsx';

export const metadata: Metadata = metadataDaPagina(
  '/funcionalidades/dorks',
  'Gerador de buscas avançadas no Google para vagas de emprego',
  'Monte buscas com os operadores do Google (site:, aspas, período) para achar vagas no LinkedIn, Gupy e outros sites. Pronta para abrir, grátis e sem limite.',
);
import estilos from './pagina.module.css';

export default function PaginaDeDorks() {
  return (
    <div className={estilos.pagina}>
      <section className={`hero ${estilos.hero}`}>
        <h1>
          Gerador de <mark>buscas avançadas</mark>
        </h1>
        <p className="hero-sub">
          Diga o cargo, os sites e o período: montamos a busca com os operadores do Google, pronta
          para abrir. Roda no seu navegador, de graça e sem limite.
        </p>
        <div className={estilos.corpo}>
          <GeradorDeDorks />
        </div>
      </section>
    </div>
  );
}
