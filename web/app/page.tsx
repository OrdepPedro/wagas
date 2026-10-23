import { carregarFeed, JANELA_DIAS, type Vaga } from '../lib/feed.ts';
import { registrarBusca } from '../lib/feed.ts';
import { estadoDoLimite } from '../lib/limites.ts';
import { lerPerfil } from '../lib/perfil.ts';
import { usuarioAtual } from '../lib/supabase.ts';
import { sair } from './actions.ts';
import { FormularioDeBusca, FormularioDeEntrada } from './formularios.tsx';

export const dynamic = 'force-dynamic';

const NOME_DA_FONTE: Record<Vaga['fonte'], string> = {
  linkedin_job: 'LinkedIn',
  linkedin_post: 'post no LinkedIn',
  ats_gupy: 'Gupy',
  portal_infojobs: 'InfoJobs',
};

const NOME_DO_MODELO: Record<'remoto' | 'hibrido' | 'presencial', string> = {
  remoto: 'remoto',
  hibrido: 'híbrido',
  presencial: 'presencial',
};

/**
 * A data é dita com a procedência junto.
 *
 * `data_publicacao` está null em 192 das 192 linhas hoje, e `data_referencia`
 * cai para a data de COLETA. Escrever "publicada há 2 dias" em cima disso seria
 * inventar: com a janela de `qdr:w`, um item coletado ontem já podia ter até
 * sete dias. "Vista em" é o que a gente realmente sabe.
 */
function textoDaData(vaga: Vaga): string {
  const formatar = (iso: string) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  if (vaga.data_publicacao) return `publicada em ${formatar(vaga.data_publicacao)}`;
  return `vista em ${formatar(vaga.data_referencia)}`;
}

/**
 * "Efetivo – CLT - Período Integral" vira "CLT"; "Prestador de Serviços (PJ) -
 * Período Integral" vira "PJ". O resto aparece como a fonte escreveu, sem a
 * jornada. A etiqueta existe para a pessoa ver "PJ" ANTES de clicar — decidir o
 * que é vaga de verdade é dela, não do parser (achado 39).
 */
function textoDoContrato(bruto: string): string {
  if (/\bCLT\b/i.test(bruto)) return 'CLT';
  if (/\bPJ\b/.test(bruto)) return 'PJ';
  return bruto.split(/\s+-\s+/)[0]!.trim();
}

function CartaoDeVaga({ vaga, cidadeSlug }: { vaga: Vaga; cidadeSlug: string }) {
  const naCidade = vaga.cidade_slug === cidadeSlug;

  return (
    <li className="vaga">
      {/* O clique passa por /ir/[id] para ser contado antes de sair. É a
          métrica do produto: clique em "ver vaga" por usuário por semana. */}
      <a className="titulo" href={`/ir/${vaga.id}`} target="_blank" rel="noopener noreferrer">
        {vaga.cargo}
      </a>
      <p className="empresa">
        {vaga.empresa === 'não identificada' ? (
          <em>empresa não identificada</em>
        ) : (
          vaga.empresa
        )}
        {vaga.localizacao ? ` · ${vaga.localizacao}` : ''}
      </p>
      <div className="etiquetas">
        {vaga.modelo ? (
          <span className={`etiqueta${vaga.modelo === 'remoto' ? ' destaque' : ''}`}>
            {NOME_DO_MODELO[vaga.modelo]}
          </span>
        ) : (
          <span className="etiqueta incerta">modelo não informado</span>
        )}
        {naCidade ? <span className="etiqueta">na sua cidade</span> : null}
        {vaga.senioridade ? <span className="etiqueta">{vaga.senioridade}</span> : null}
        {vaga.tipo_contrato ? <span className="etiqueta">{textoDoContrato(vaga.tipo_contrato)}</span> : null}
        {vaga.repeticoes && vaga.repeticoes > 1 ? (
          <span className="etiqueta">{vaga.repeticoes} anúncios iguais</span>
        ) : null}
        <span className="etiqueta">{NOME_DA_FONTE[vaga.fonte]}</span>
        <span className="etiqueta">{textoDaData(vaga)}</span>
      </div>
    </li>
  );
}

/**
 * O estado vazio não é uma tela de desculpa: é coleta de dado.
 *
 * O cache cobre pares cargo × cidade, e o custo do produto escala com pares
 * distintos, não com usuários. Saber QUAIS pares as pessoas pedem e não
 * encontram é a fila de priorização da próxima varredura — por isso a busca é
 * gravada com a contagem de resultados mesmo (e principalmente) quando ela é
 * zero. Ver a view `demanda_descoberta`.
 */
function FeedVazio({
  cargo,
  cidade,
  soRemoto,
}: {
  cargo: string;
  cidade: string;
  soRemoto: boolean;
}) {
  // O formulário NÃO se repete aqui: ele está fixo no topo da página, onde
  // sempre esteve o certo. A versão anterior o escondia no rodapé, dentro de um
  // <details> fechado chamado "Mudar cargo ou cidade" — a ação principal de um
  // produto cuja premissa é "o usuário informa cargo e cidade" ficava abaixo da
  // dobra e com nome de configuração.
  return (
    <>
      <div className="caixa aviso" style={{ marginBottom: 24 }}>
        <p>
          Ainda não cobrimos <strong>{cargo}</strong>{' '}
          {soRemoto ? <>em vagas remotas</> : <>em <strong>{cidade}</strong></>}.
        </p>
        <p className="fraco" style={{ margin: 0 }}>
          Anotei o seu pedido. A gente varre novos cargos e cidades por ordem de quem pediu — e
          este par acabou de entrar na fila.
        </p>
      </div>
    </>
  );
}

/**
 * Teto diário estourado.
 *
 * Não some com o feed: o acervo que a pessoa já tem continua visível. O que o
 * teto impede é DISPARAR trabalho novo — varredura na fonte externa e, mais
 * adiante, coleta paga. Esconder o que já existe seria punir sem motivo.
 */
function LimiteEstourado({ teto, visitante }: { teto: number; visitante: boolean }) {
  return (
    <div className="caixa aviso" style={{ marginBottom: 24 }}>
      <p>
        Você já fez {teto} {teto === 1 ? 'busca' : 'buscas'} hoje.
      </p>
      <p className="fraco" style={{ margin: 0 }}>
        {visitante
          ? 'Entrar com e-mail aumenta o limite. O contador zera à meia-noite.'
          : 'O contador zera à meia-noite. Recarregar o feed não conta — só trocar de cargo ou cidade.'}
      </p>
      {visitante ? (
        <div style={{ marginTop: 16 }}>
          <FormularioDeEntrada />
        </div>
      ) : null}
    </div>
  );
}

async function Feed({
  cargo,
  cidade,
  soRemoto,
  userId,
  visitante,
}: {
  cargo: string;
  cidade: string;
  soRemoto: boolean;
  userId: string;
  visitante: boolean;
}) {
  const limite = await estadoDoLimite(userId, visitante, cargo, cidade);

  // ORDEM QUE IMPORTA: o teto é consultado ANTES de `carregarFeed`, porque é
  // ela que dispara a coleta na fonte externa. Checar depois gastaria a
  // varredura e só então diria "não pode".
  const { vagas, cidadeSlug, naCidade, remotas } = await carregarFeed(cargo, cidade, {
    ...(soRemoto ? { soRemoto: true } : {}),
    ...(limite.estourou ? { apenasCache: true } : {}),
  });
  await registrarBusca(userId, cargo, cidade, cidadeSlug, vagas.length);

  if (vagas.length === 0) {
    return (
      <>
        {limite.estourou ? <LimiteEstourado teto={limite.teto} visitante={visitante} /> : null}
        <FeedVazio cargo={cargo} cidade={cidade} soRemoto={soRemoto} />
      </>
    );
  }

  return (
    <>
      {limite.estourou ? <LimiteEstourado teto={limite.teto} visitante={visitante} /> : null}
      <p className="resumo">
        {vagas.length} {vagas.length === 1 ? 'vaga' : 'vagas'} —{' '}
        {soRemoto
          ? `${remotas} ${remotas === 1 ? 'remota' : 'remotas'} em todo o Brasil`
          : `${naCidade} em ${cidade}, ${remotas} ${remotas === 1 ? 'remota no Brasil' : 'remotas no Brasil'}`}
        .
      </p>
      <ul className="vagas">
        {vagas.map((vaga) => (
          <CartaoDeVaga key={vaga.id} vaga={vaga} cidadeSlug={cidadeSlug} />
        ))}
      </ul>
      <div className="rodape">
        <p className="limite">
          {limite.restantes} de {limite.teto}{' '}
          {limite.teto === 1 ? 'busca restante' : 'buscas restantes'} hoje.
        </p>
      </div>
    </>
  );
}

export default async function Pagina() {
  const usuario = await usuarioAtual();

  if (!usuario) {
    return (
      <>
        <div className="cabecalho">
          <div>
            <h1>wagas</h1>
            <p className="fraco" style={{ margin: 0 }}>
              Vagas dos últimos {JANELA_DIAS} dias para o seu cargo e a sua cidade — inclusive as
              que só existem como post de recrutador.
            </p>
          </div>
        </div>
        <FormularioDeEntrada />
      </>
    );
  }

  const perfil = await lerPerfil(usuario.id);

  if (!perfil) {
    return (
      <>
        <div className="cabecalho">
          <div>
            <h1>O que você procura?</h1>
            <p className="fraco" style={{ margin: 0 }}>
              Cargo e cidade. O feed junta o que é presencial ou híbrido na sua cidade com o que é
              remoto em todo o Brasil.
            </p>
          </div>
        </div>
        <FormularioDeBusca />
      </>
    );
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>{perfil.cargo}</h1>
          <p className="fraco" style={{ margin: 0 }}>
            {perfil.soRemoto ? 'remoto em todo o Brasil' : `${perfil.cidade} e remoto no Brasil`} ·
            últimos {JANELA_DIAS} dias
          </p>
        </div>
        {/* Visitante não tem "Sair": sair apagaria a sessão anônima, o proxy
            criaria outra no próximo acesso, e o teto zeraria com um clique. */}
        {usuario.visitante ? null : (
          <form action={sair}>
            <button type="submit" className="discreto">
              Sair
            </button>
          </form>
        )}
      </div>

      {/* A busca é a ação principal do produto, então fica no topo e aberta.
          Ela renderiza na hora; o feed abaixo é assíncrono e chega depois. */}
      <section className="busca">
        <FormularioDeBusca
          cargo={perfil.cargo}
          cidade={perfil.cidade}
          soRemoto={perfil.soRemoto}
          rotulo="Buscar"
        />
      </section>

      <Feed
        cargo={perfil.cargo}
        cidade={perfil.cidade}
        soRemoto={perfil.soRemoto}
        userId={usuario.id}
        visitante={usuario.visitante}
      />
    </>
  );
}
