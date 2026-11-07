/** Página da extensão na Chrome Web Store. Um endereço só, para todo lugar que a cita. */
export const URL_EXTENSAO =
  'https://chromewebstore.google.com/detail/kolfemedccejbfoogdokjbjhallobgmp?utm_source=item-share-cb';

/**
 * Chamada para a extensão do Chrome.
 *
 * `destaque` é a faixa da landing, para quem ainda não tem conta; `compacta`
 * aparece nas telas de currículo, onde a pessoa já guardou (ou vai guardar) o
 * CV que a extensão usa. O texto não promete leitura da página: a extensão só
 * recebe o que a pessoa cola.
 */
export function ExtensaoChrome({ variante = 'compacta' }: { variante?: 'destaque' | 'compacta' }) {
  if (variante === 'destaque') {
    return (
      <section className="extensao destaque" aria-labelledby="extensao-titulo">
        <div className="extensao-texto">
          <p className="extensao-selo">Novo · Extensão para Chrome</p>
          <h2 id="extensao-titulo">Viu uma vaga em outro site? Adapte o currículo ali mesmo.</h2>
          <p>
            Abra o painel do wagas ao lado da página, cole a descrição da vaga e baixe o seu currículo
            adaptado a ela, em PDF. Sem inventar experiência: o que a vaga pede e você não mostra aparece
            numa lista à parte.
          </p>
          <a className="extensao-botao" href={URL_EXTENSAO} target="_blank" rel="noopener noreferrer">
            <IconeChrome />
            Adicionar ao Chrome — grátis
          </a>
          <p className="extensao-nota">Usa o currículo salvo na sua conta do wagas.</p>
        </div>
      </section>
    );
  }

  return (
    <aside className="extensao compacta" aria-label="Extensão do wagas para Chrome">
      <IconeChrome />
      <div>
        <p>
          <strong>Achou a vaga em outro site?</strong> Com a extensão do wagas para Chrome, você cola a vaga
          num painel ao lado da página e recebe o seu currículo salvo adaptado a ela, em PDF.
        </p>
        <a href={URL_EXTENSAO} target="_blank" rel="noopener noreferrer">
          Instalar a extensão
        </a>
      </div>
    </aside>
  );
}

function IconeChrome() {
  return (
    <span className="extensao-icone" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
        <path d="M15 9v11" />
        <path d="M17.5 13h1.5M17.5 16h1.5" />
      </svg>
    </span>
  );
}
