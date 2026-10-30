import { carregarFeed, JANELA_DIAS, type Vaga } from '../../lib/feed.ts';
import { registrarBusca } from '../../lib/feed.ts';
import { estadoDoLimite, LIMITE_GRATUITO, type EstadoDoLimite } from '../../lib/limites.ts';
import { cidadeDoFormulario, lerPerfil } from '../../lib/perfil.ts';
import { chaveDoPar } from '../../../src/feed/pares-do-dia.ts';
import { slugCidade } from '../../../src/normalize/local.ts';
import { usuarioAtual } from '../../lib/supabase.ts';
import { sair, voltarParaBusca } from '../actions.ts';
import { redirect } from 'next/navigation';
import { FormularioDeBusca, FormularioDeEntrada } from '../formularios.tsx';

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

const formatarDia = (d: Date) =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

/**
 * Teto estourado.
 *
 * Não some com o feed: o acervo que a pessoa já tem continua visível. O que o
 * teto impede é DISPARAR trabalho novo — varredura na fonte externa e, mais
 * adiante, coleta paga. Esconder o que já existe seria punir sem motivo.
 */
function LimiteEstourado({ limite }: { limite: EstadoDoLimite }) {
  const { teto, visitante, vagas } = limite;
  const proxima = vagas
    .map((v) => v.liberaEm)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    <div className="caixa aviso" style={{ marginBottom: 24 }}>
      <p>
        {visitante
          ? `Você já usou as ${teto} buscas de visitante. Estas vagas são só do que já estava no nosso acervo.`
          : `Você já fez ${teto} ${teto === 1 ? 'busca' : 'buscas'} hoje.`}
      </p>
      <p className="fraco" style={{ margin: 0 }}>
        {visitante
          ? `${proxima ? `Uma busca libera em ${formatarDia(proxima)}. ` : ''}Entrar com e-mail libera ${LIMITE_GRATUITO} buscas por dia.`
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

/**
 * As buscas salvas do visitante, como atalho. Voltar a uma delas não gasta
 * nada — é o que faz "2 buscas por 7 dias" ser uma oferta e não uma prisão.
 */
function BuscasSalvas({ limite, cargo, cidade }: { limite: EstadoDoLimite; cargo: string; cidade: string }) {
  if (!limite.visitante || limite.vagas.length === 0) return null;
  const atual = chaveDoPar(cargo, slugCidade(cidade));

  return (
    <div className="salvas">
      <p className="fraco">
        Suas buscas salvas ({limite.vagas.length} de {limite.teto}):
      </p>
      <ul>
        {limite.vagas.map((v) => {
          const eAtual = v.chave === atual;
          return (
            <li key={v.chave}>
              <form action={voltarParaBusca}>
                <input type="hidden" name="cargo" value={v.cargo} />
                <input type="hidden" name="cidade" value={v.cidade} />
                <button type="submit" className={eAtual ? 'salva atual' : 'salva'} disabled={eAtual}>
                  {v.cargo} · {v.cidade}
                </button>
              </form>
              {v.liberaEm ? <small className="fraco">libera em {formatarDia(v.liberaEm)}</small> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** O que guardamos do visitante, dito na tela (LGPD: transparência). */
function AvisoDePrivacidade() {
  return (
    <p className="fraco privacidade">
      Sem cadastro, guardamos só um identificador anônimo, os cargos e cidades que você buscou e as
      vagas que você abriu. Se você ficar 30 dias sem voltar, o identificador é apagado e o histórico
      fica sem ligação com você.
    </p>
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
        <BuscasSalvas limite={limite} cargo={cargo} cidade={cidade} />
        {limite.estourou ? <LimiteEstourado limite={limite} /> : null}
        <FeedVazio cargo={cargo} cidade={cidade} soRemoto={soRemoto} />
      </>
    );
  }

  return (
    <>
      <BuscasSalvas limite={limite} cargo={cargo} cidade={cidade} />
      {limite.estourou ? <LimiteEstourado limite={limite} /> : null}
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
          {limite.teto === 1 ? 'busca restante' : 'buscas restantes'}
          {visitante ? ' — cada busca de visitante vale 7 dias.' : ' hoje.'}
        </p>
        {visitante ? <AvisoDePrivacidade /> : null}
      </div>
    </>
  );
}

export default async function PaginaDoFeed() {
  const usuario = await usuarioAtual();

  // O feed mora em /vagas; a landing, em /. Sem sessão ou sem busca salva, não
  // há feed para mostrar — volta para a landing, que é onde se busca.
  if (!usuario) redirect('/');

  const perfil = await lerPerfil(usuario.id);

  if (!perfil) redirect('/');

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
          cidade={cidadeDoFormulario(perfil)}
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
