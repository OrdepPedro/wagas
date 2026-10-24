import { JANELA_DIAS } from '../lib/feed.ts';
import { LIMITE_GRATUITO, LIMITE_VISITANTE } from '../lib/limites.ts';
import type { CartaoDaVitrine, Vitrine } from '../lib/vitrine.ts';
import { FormularioDeBusca } from './formularios.tsx';

/**
 * Landing: o que todo visitante vê antes da primeira busca.
 *
 * Estrutura inspirada na JobStep (hero de impacto, janela do produto, passos,
 * blocos com mockup, privacidade, FAQ, chamada final), com uma diferença de
 * princípio: aqui só entra o que o wagas FAZ HOJE. Nada de currículo, carta ou
 * planos que não existem, e nada de prova social inventada — o selo é a
 * contagem viva do acervo e os cartões da janela são vagas reais do banco.
 *
 * A busca fica no hero, não atrás de um "Começar": a premissa do produto é
 * "informe cargo e cidade", e cada clique antes disso é gente indo embora.
 */
export function Landing({
  formulario,
  vitrine = { vagasNaJanela: null, cartoes: [] },
}: {
  formulario?: React.ReactNode;
  vitrine?: Vitrine;
}) {
  const { vagasNaJanela, cartoes } = vitrine;

  return (
    <div className="landing">
      {/* ---------- hero ---------- */}
      <section className="hero">
        <p className="selo">
          <span className="ponto" aria-hidden="true" />
          {vagasNaJanela
            ? `${vagasNaJanela.toLocaleString('pt-BR')} vagas publicadas nos últimos ${JANELA_DIAS} dias`
            : `Só vagas publicadas nos últimos ${JANELA_DIAS} dias`}
        </p>
        <h1>
          Chega de anúncio velho.
          <br />
          <mark>Só vagas desta semana.</mark>
        </h1>
        <p className="hero-sub">
          O wagas junta as vagas dos últimos {JANELA_DIAS} dias para o seu cargo — presenciais e
          híbridas na sua cidade, remotas de todo o Brasil — e leva você direto ao anúncio original.
        </p>

        <div className="hero-busca" id="busca">
          {formulario ?? <FormularioDeBusca hero rotulo="Ver vagas" />}
        </div>

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

      {/* ---------- janela do produto, com vagas reais ---------- */}
      {cartoes.length > 0 ? (
        <section className="janela" aria-label="Exemplo do feed com vagas reais desta semana">
          <div className="janela-barra" aria-hidden="true">
            <span />
            <span />
            <span />
            <div className="janela-url">wagas · seu feed da semana</div>
          </div>
          <div className="janela-corpo">
            <p className="janela-legenda">Vagas reais, publicadas nos últimos dias</p>
            <ul>
              {cartoes.map((c) => (
                <CartaoExemplo key={c.id} cartao={c} />
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <p className="faixa-fontes">
        Coletamos todo dia de <strong>Gupy</strong> · <strong>InfoJobs</strong> ·{' '}
        <strong>LinkedIn Jobs</strong>
      </p>

      {/* ---------- passos ---------- */}
      <section className="secao" aria-labelledby="passos-titulo">
        <p className="sobretitulo">Como funciona</p>
        <h2 id="passos-titulo">Da busca à candidatura em 3 passos</h2>
        <ol className="passos">
          <li>
            <span className="passo">1</span>
            <h3>Diga o cargo e a cidade</h3>
            <p>
              Do seu jeito. Buscar “Product Manager” também traz Product Owner; “Auxiliar” também
              traz Assistente.
            </p>
          </li>
          <li>
            <span className="passo">2</span>
            <h3>Veja só o que é desta semana</h3>
            <p>
              Vaga com mais de {JANELA_DIAS} dias não entra. Cada cartão diz quando foi publicada e de
              onde veio.
            </p>
          </li>
          <li>
            <span className="passo">3</span>
            <h3>Candidate-se na origem</h3>
            <p>Um clique leva ao anúncio original, na plataforma da empresa.</p>
          </li>
        </ol>
      </section>

      {/* ---------- blocos ---------- */}
      <section className="secao" aria-labelledby="blocos-titulo">
        <p className="sobretitulo">Por que o wagas</p>
        <h2 id="blocos-titulo">Menos tempo procurando, mais tempo se candidatando</h2>

        <div className="bloco">
          <div className="bloco-texto">
            <p className="rotulo">Frescor</p>
            <h3>Só o que é desta semana</h3>
            <p>
              Vaga antiga é a que já tem centenas de candidatos — ou já foi preenchida. O feed tem
              janela fixa de {JANELA_DIAS} dias: o que passou disso sai sozinho.
            </p>
          </div>
          <div className="bloco-visual" aria-hidden="true">
            <ul className="mock-datas">
              <li>
                <span>Vendedor(a) de Loja</span>
                <em className="ok">hoje</em>
              </li>
              <li>
                <span>Auxiliar Administrativo</span>
                <em className="ok">ontem</em>
              </li>
              <li>
                <span>Analista de Dados</span>
                <em className="ok">há 4 dias</em>
              </li>
              <li className="fora">
                <span>Enfermeiro(a)</span>
                <em>há 23 dias</em>
              </li>
            </ul>
          </div>
        </div>

        <div className="bloco invertido">
          <div className="bloco-texto">
            <p className="rotulo">Sem repetição</p>
            <h3>Uma vaga, um cartão</h3>
            <p>
              Tem empresa que publica o mesmo anúncio dezenas de vezes. Você vê um cartão só, com a
              indicação de quantos anúncios iguais existem.
            </p>
          </div>
          <div className="bloco-visual" aria-hidden="true">
            <div className="mock-pilha">
              <div className="mock-cartao fantasma" />
              <div className="mock-cartao fantasma" />
              <div className="mock-cartao">
                <strong>Atendente de Restaurante</strong>
                <span className="fraco">Rio de Janeiro - RJ</span>
                <span className="etiqueta destaque">29 anúncios iguais</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bloco">
          <div className="bloco-texto">
            <p className="rotulo">Remoto</p>
            <h3>Remoto de todo o Brasil, junto da sua cidade</h3>
            <p>
              O feed soma as vagas presenciais e híbridas da sua cidade com as remotas do país
              inteiro. Quer só remoto? Um clique e a cidade deixa de importar.
            </p>
          </div>
          <div className="bloco-visual" aria-hidden="true">
            <div className="mock-chave">
              <span className="chave ligada">
                <span />
              </span>
              Só vagas remotas
            </div>
            <div className="mock-etiquetas">
              <span className="etiqueta destaque">remoto</span>
              <span className="etiqueta">híbrido</span>
              <span className="etiqueta">presencial</span>
              <span className="etiqueta">na sua cidade</span>
            </div>
          </div>
        </div>

        <div className="bloco invertido">
          <div className="bloco-texto">
            <p className="rotulo">Transparência</p>
            <h3>Você vê de onde vem cada vaga</h3>
            <p>
              Fonte, data de publicação e tipo de contrato no próprio cartão. Você sabe que é PJ
              antes de clicar, não depois.
            </p>
          </div>
          <div className="bloco-visual" aria-hidden="true">
            <div className="mock-cartao">
              <strong>Desenvolvedor(a) Back-End</strong>
              <span className="fraco">Empresa · Remoto</span>
              <div className="mock-etiquetas">
                <span className="etiqueta destaque">remoto</span>
                <span className="etiqueta">PJ</span>
                <span className="etiqueta">InfoJobs</span>
                <span className="etiqueta">publicada em 21/10</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- privacidade ---------- */}
      <section className="secao" id="privacidade" aria-labelledby="privacidade-titulo">
        <p className="sobretitulo">Privacidade</p>
        <h2 id="privacidade-titulo">Seus dados, o mínimo possível</h2>
        <div className="cartoes">
          <div className="cartao">
            <Escudo />
            <h3>Sem cadastro</h3>
            <p>
              Para buscar, não pedimos nome, e-mail nem currículo. Só um identificador anônimo
              guarda as suas buscas.
            </p>
          </div>
          <div className="cartao">
            <Escudo />
            <h3>Apagado em 30 dias</h3>
            <p>
              Ficou 30 dias sem voltar? O identificador é apagado e o histórico deixa de ter
              ligação com você, como pede a LGPD.
            </p>
          </div>
          <div className="cartao">
            <Escudo />
            <h3>Só fontes públicas</h3>
            <p>
              Lemos apenas anúncios abertos ao público. Nada que dependa do login de alguém, nem
              do seu.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="secao" aria-labelledby="faq-titulo">
        <p className="sobretitulo">Dúvidas</p>
        <h2 id="faq-titulo">Perguntas frequentes</h2>
        <div className="faq">
          <details>
            <summary>É grátis?</summary>
            <p>
              Sim. Sem cadastro, você tem {LIMITE_VISITANTE} buscas salvas, e cada uma vale{' '}
              {JANELA_DIAS} dias — dá para voltar a elas quantas vezes quiser. Entrando com e-mail,
              são {LIMITE_GRATUITO} buscas por dia.
            </p>
          </details>
          <details>
            <summary>De onde vêm as vagas?</summary>
            <p>
              De Gupy, InfoJobs e LinkedIn Jobs, coletadas todo dia. Cada cartão diz a fonte e leva
              ao anúncio original.
            </p>
          </details>
          <details>
            <summary>Por que só {JANELA_DIAS} dias?</summary>
            <p>
              Porque vaga velha costuma já ter candidatos demais ou já ter sido preenchida. Uma
              janela curta mantém o feed com o que ainda vale a pena.
            </p>
          </details>
          <details>
            <summary>Minha busca veio com poucas vagas. Por quê?</summary>
            <p>
              Ainda não cobrimos bem todo cargo em toda cidade. Quando uma busca volta vazia, ela
              entra na nossa fila — os pares mais pedidos são coletados primeiro.
            </p>
          </details>
          <details>
            <summary>Vocês se candidatam por mim?</summary>
            <p>
              Não. O wagas encontra a vaga; a candidatura acontece no anúncio original, na
              plataforma da empresa.
            </p>
          </details>
        </div>
      </section>

      {/* ---------- chamada final ---------- */}
      <section className="final">
        <h2>Sua próxima vaga foi publicada esta semana.</h2>
        <p>Diga o cargo e a cidade. Leva menos de um minuto.</p>
        <a href="#busca" className="botao">
          Buscar vagas
        </a>
      </section>

      <footer className="rodape-landing">
        <span>wagas · vagas dos últimos {JANELA_DIAS} dias</span>
        <a href="#privacidade">Privacidade</a>
      </footer>
    </div>
  );
}

const NOME_DA_FONTE: Record<CartaoDaVitrine['fonte'], string> = {
  linkedin_job: 'LinkedIn',
  linkedin_post: 'post no LinkedIn',
  ats_gupy: 'Gupy',
  portal_infojobs: 'InfoJobs',
};

const NOME_DO_MODELO = { remoto: 'remoto', hibrido: 'híbrido', presencial: 'presencial' } as const;

function idade(iso: string): string {
  const dias = Math.floor((Date.now() - Date.parse(iso)) / (24 * 60 * 60 * 1000));
  if (dias <= 0) return 'publicada hoje';
  if (dias === 1) return 'publicada ontem';
  return `publicada há ${dias} dias`;
}

function CartaoExemplo({ cartao }: { cartao: CartaoDaVitrine }) {
  return (
    <li className="vaga">
      <span className="titulo">{cartao.cargo}</span>
      <p className="empresa">
        {cartao.empresa}
        {cartao.localizacao ? ` · ${cartao.localizacao}` : ''}
      </p>
      <div className="etiquetas">
        {cartao.modelo ? (
          <span className={`etiqueta${cartao.modelo === 'remoto' ? ' destaque' : ''}`}>
            {NOME_DO_MODELO[cartao.modelo]}
          </span>
        ) : null}
        <span className="etiqueta">{NOME_DA_FONTE[cartao.fonte]}</span>
        <span className="etiqueta">{idade(cartao.data_publicacao)}</span>
      </div>
    </li>
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

function Escudo() {
  return (
    <span className="icone-cartao" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path
          d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6l7-3Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M9 12l2.2 2.2L15.5 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
