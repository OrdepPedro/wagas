import { GeradorDeDorks } from './gerador.tsx';
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
