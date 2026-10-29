import { Medidor } from './medidor.tsx';

/** Uma chamada ao Gemini leva de 5 a 20 s; com uma retentativa, até um minuto. */
export const maxDuration = 60;

export default function PaginaDoMedidor() {
  return (
    <div className="funcionalidades">
      <h1>Medidor de currículo para ATS</h1>
      <p className="fraco">
        Avaliamos se sistemas de recrutamento conseguem ler o seu currículo, se ele mostra o que o cargo
        pede e se convence quem lê. A nota é um diagnóstico do wagas, não a nota da Gupy, do LinkedIn ou de
        qualquer empresa: nenhum ATS publica a nota que dá.
      </p>
      <Medidor />
    </div>
  );
}
