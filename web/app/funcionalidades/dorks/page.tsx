import { GeradorDeDorks } from './gerador.tsx';

export default function PaginaDeDorks() {
  return (
    <div className="funcionalidades">
      <h1>Gerador de buscas avançadas</h1>
      <p className="fraco">
        Montamos a busca com os operadores do Google (<code>site:</code>, aspas, período). A busca
        roda no seu navegador, no Google — de graça e sem limite.
      </p>
      <GeradorDeDorks />
    </div>
  );
}
