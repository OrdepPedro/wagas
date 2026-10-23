import { JANELA_DIAS } from '../lib/feed.ts';
import { FormularioDeBusca } from './formularios.tsx';

/**
 * Landing: o que todo visitante vê antes da primeira busca.
 *
 * A busca está NO hero, não depois de um botão "começar": a premissa do produto
 * é "informe cargo e cidade", e cada clique antes disso é gente indo embora.
 *
 * Confiança vem de dizer o que é verificável, não de número inventado. Nada de
 * "milhares de vagas" ou logo de cliente: as frases abaixo são promessas que o
 * feed cumpre — data visível, fonte visível, link para o anúncio original,
 * nenhum cadastro para começar.
 */
export function Landing({ formulario }: { formulario?: React.ReactNode }) {
  return (
    <div className="landing">
      <section className="hero">
        <p className="selo">
          <span className="ponto" aria-hidden="true" />
          Só vagas publicadas nos últimos {JANELA_DIAS} dias
        </p>
        <h1>Vagas novas para o seu cargo, na sua cidade.</h1>
        <p className="hero-sub">
          Juntamos num lugar só as vagas presenciais e híbridas da sua cidade e as remotas de todo
          o Brasil. Você vê quando cada uma foi publicada e vai direto ao anúncio original.
        </p>

        <div className="hero-busca">{formulario ?? <FormularioDeBusca hero rotulo="Ver vagas" />}</div>

        <ul className="garantias" aria-label="O que você precisa saber">
          <li>
            <Check />
            Sem cadastro para começar
          </li>
          <li>
            <Check />
            Grátis
          </li>
          <li>
            <Check />
            Link direto para a vaga
          </li>
        </ul>
      </section>

      <section className="como" aria-labelledby="como-titulo">
        <h2 id="como-titulo">Como funciona</h2>
        <ol>
          <li>
            <span className="passo">1</span>
            <div>
              <h3>Diga o cargo e a cidade</h3>
              <p>
                Escreva do seu jeito. Buscar “Product Manager” também traz Product Owner; buscar
                “Auxiliar” também traz Assistente.
              </p>
            </div>
          </li>
          <li>
            <span className="passo">2</span>
            <div>
              <h3>Veja só o que é recente</h3>
              <p>
                Vaga com mais de {JANELA_DIAS} dias não entra. Cada cartão mostra a data de publicação e
                de onde a vaga veio.
              </p>
            </div>
          </li>
          <li>
            <span className="passo">3</span>
            <div>
              <h3>Candidate-se na origem</h3>
              <p>
                O botão leva ao anúncio original, na plataforma da empresa. A gente não intermedia a
                sua candidatura.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="confianca" aria-labelledby="confianca-titulo">
        <h2 id="confianca-titulo">De onde vêm as vagas</h2>
        <div className="cartoes">
          <div className="cartao">
            <h3>Fontes públicas</h3>
            <p>
              Gupy, InfoJobs e LinkedIn Jobs. Só anúncio que está aberto ao público — nada que
              exija login de alguém.
            </p>
          </div>
          <div className="cartao">
            <h3>Repetidas viram uma</h3>
            <p>
              Quando a mesma vaga aparece várias vezes, você vê um cartão só, com a indicação de
              quantos anúncios iguais existem.
            </p>
          </div>
          <div className="cartao">
            <h3>Seus dados, o mínimo</h3>
            <p>
              Sem cadastro, guardamos só um identificador anônimo e o que você buscou. Depois de 30
              dias sem uso, ele é apagado.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--acento-fraco)" />
      <path
        d="M6 10.2l2.6 2.6L14 7.4"
        fill="none"
        stroke="var(--acento)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
