import { redirect } from 'next/navigation';
import { vagaAdaptavel } from '../../../../src/curriculo/adaptar.ts';
import {
  adaptacaoDisponivel,
  adaptacoesHoje,
  correcoesHoje,
  lerAdaptacao,
  lerCurriculo,
  LIMITE_ADAPTACOES,
  LIMITE_CORRECOES,
  type Adaptacao,
  type Mensagem,
} from '../../../lib/adaptacao.ts';
import { clienteDoServidor, usuarioAtual } from '../../../lib/supabase.ts';
import { ExtensaoChrome } from '../../extensao-chrome.tsx';
import { FormularioDeEntrada } from '../../formularios.tsx';
import { confirmarAcao } from '../../curriculo/actions.ts';
import { BotaoDeAdaptar, PedidoDeAjuste } from '../../curriculo/formularios.tsx';
import { ChatFlutuante, CurriculoEditavel } from './revisao.tsx';

export const dynamic = 'force-dynamic';

function Conversa({ conversa }: { conversa: Mensagem[] }) {
  if (conversa.length === 0) {
    return (
      <p className="fraco">
        Diga o que mudar, um pedido de cada vez. O que você afirmar sobre você vale como fato; o que a IA não puder
        confirmar, ela não escreve.
      </p>
    );
  }
  return (
    <ol className="conversa">
      {conversa.map((m, i) =>
        m.manual ? (
          <li key={i} className="conversa-nota">
            Você editou o currículo à mão.
          </li>
        ) : (
          <li key={i}>
            <p className="conversa-pedido">{m.pedido}</p>
            <p className="conversa-resposta">
              {m.resposta}
              {m.mudou ? null : <span className="fraco"> (o currículo não mudou)</span>}
            </p>
          </li>
        ),
      )}
    </ol>
  );
}

function Resultado({
  jobId,
  adaptacao,
  ajustesRestantes,
}: {
  jobId: number;
  adaptacao: Adaptacao;
  ajustesRestantes: number;
}) {
  const { resultado: cv, alertas } = adaptacao;
  const desligado = !adaptacaoDisponivel()
    ? 'Os ajustes pela IA estão desligados neste ambiente.'
    : ajustesRestantes === 0
      ? `Você já fez ${LIMITE_CORRECOES} ajustes hoje. O contador zera à meia-noite.`
      : null;
  return (
    <>
      <p className="fraco">
        Leia o currículo adaptado com calma. Se algo estiver errado, exagerado ou faltando, edite à mão ou peça o
        ajuste à IA no chat do canto da tela. Quando estiver bom, confirme no fim da página para baixar o PDF.
      </p>

      {adaptacao.corrigidos > 0 ? (
        <p className="fraco">
          A IA escreveu {adaptacao.corrigidos === 1 ? 'um nome' : `${adaptacao.corrigidos} nomes`} de empresa ou
          cargo com a grafia errada. Voltei para a grafia do seu currículo.
        </p>
      ) : null}

      {alertas.length > 0 ? (
        <div className="caixa aviso" style={{ marginBottom: 20 }}>
          <p>
            <strong>Confira antes de enviar.</strong> Estes trechos citam algo que não encontrei no seu
            currículo original nem no que você disse no chat:
          </p>
          <ul>
            {alertas.map((a, i) => (
              <li key={i}>
                {a.tipo === 'empresa' ? 'Empresa: ' : ''}“{a.trecho}”
                {a.tipo === 'acrescimo' && a.palavras ? (
                  <span className="fraco"> — não está no original: {a.palavras.join(', ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="fraco" style={{ margin: 0 }}>
            Se não for verdade, peça à IA para tirar, ou corrija o currículo salvo.
          </p>
        </div>
      ) : null}

      {cv.mudancas.length > 0 ? (
        <div className="caixa" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>O que mudou</h3>
          <ul>
            {cv.mudancas.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {cv.lacunas.length > 0 ? (
        <div className="caixa" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>O que a vaga pede e o seu currículo não mostra</h3>
          <p className="fraco">
            Ficou fora do currículo de propósito — não inventamos experiência. Se você tem, diga no chat
            abaixo (ou acrescente ao currículo salvo); se não tem, vale preparar a resposta para a entrevista.
          </p>
          <ul>
            {cv.lacunas.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <CurriculoEditavel jobId={jobId} cv={cv} />

      <ChatFlutuante
        mensagens={adaptacao.conversa.length}
        conversa={<Conversa conversa={adaptacao.conversa} />}
        rodape={
          <>
            <PedidoDeAjuste jobId={jobId} desligado={desligado} />
            <p className="limite">
              {ajustesRestantes} de {LIMITE_CORRECOES} ajustes restantes hoje.
            </p>
          </>
        }
      />

      <section className={`caixa confirmacao${adaptacao.confirmada ? ' boa' : ''}`} id="baixar">
        {adaptacao.confirmada ? (
          <>
            <p>
              <strong>Versão confirmada.</strong> Se pedir outro ajuste, você confirma de novo antes de baixar.
            </p>
            <div className="acoes-cv" style={{ marginBottom: 0 }}>
              <a className="botao" href={`/adaptar/${jobId}/pdf`}>
                Baixar PDF
              </a>
              {/* Pelo /ir para o clique contar: CV gerado → foi para a vaga é a métrica do diferencial. */}
              <a className="link-feed" href={`/ir/${jobId}`} target="_blank" rel="noopener noreferrer">
                Ver vaga e se candidatar
              </a>
            </div>
          </>
        ) : (
          <form action={confirmarAcao}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="versao" value={adaptacao.versao} />
            <p>
              <strong>Leu tudo e está de acordo?</strong> O PDF sai exatamente com o que está acima.
            </p>
            <button type="submit">Revisei — gerar o PDF</button>
          </form>
        )}
      </section>

      <ExtensaoChrome />
    </>
  );
}

export default async function PaginaDaAdaptacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId < 1) redirect('/vagas');

  const usuario = await usuarioAtual();
  if (!usuario) redirect('/');

  const supabase = await clienteDoServidor();
  const { data: vaga } = await supabase
    .from('jobs')
    .select('cargo, empresa, descricao, fonte')
    .eq('id', jobId)
    .maybeSingle();
  if (!vaga) redirect('/vagas');

  const cabecalho = (
    <div className="cabecalho">
      <div>
        <h1>Currículo para {vaga.cargo}</h1>
        <p className="fraco" style={{ margin: 0 }}>
          {vaga.empresa === 'não identificada' ? 'empresa não identificada' : vaga.empresa}
        </p>
      </div>
      <a href="/vagas" className="link-feed">
        Voltar às vagas
      </a>
    </div>
  );

  if (usuario.visitante) {
    return (
      <>
        {cabecalho}
        <div className="caixa aviso" style={{ marginBottom: 24 }}>
          <p>Para adaptar o seu currículo a esta vaga, entre com seu e-mail.</p>
          <p className="fraco" style={{ margin: 0 }}>
            Currículo é dado pessoal: guardamos só para quem tem conta, e você pode apagar quando quiser.
          </p>
        </div>
        <FormularioDeEntrada />
      </>
    );
  }

  if (!vagaAdaptavel(vaga)) {
    return (
      <>
        {cabecalho}
        <div className="caixa aviso">
          <p style={{ margin: 0 }}>
            Esta vaga veio sem a descrição completa, então não há o que adaptar. Abra a vaga na fonte.
          </p>
        </div>
      </>
    );
  }

  const curriculo = await lerCurriculo(usuario.id);
  if (!curriculo) {
    return (
      <>
        {cabecalho}
        <div className="caixa" style={{ marginBottom: 24 }}>
          <p>Primeiro, o seu currículo. Você guarda uma vez e adapta para qualquer vaga com um clique.</p>
          <a className="botao" href={`/curriculo?vaga=${jobId}`}>
            Enviar meu currículo
          </a>
        </div>
      </>
    );
  }

  const adaptacao = await lerAdaptacao(usuario.id, jobId, curriculo);
  if (adaptacao) {
    return (
      <>
        {cabecalho}
        <Resultado
          jobId={jobId}
          adaptacao={adaptacao}
          ajustesRestantes={Math.max(LIMITE_CORRECOES - (await correcoesHoje(usuario.id)), 0)}
        />
      </>
    );
  }

  const disponivel = adaptacaoDisponivel();
  const usadas = await adaptacoesHoje(usuario.id);

  return (
    <>
      {cabecalho}
      <div className="caixa" style={{ marginBottom: 24 }}>
        <p>
          A IA lê a descrição desta vaga e reorganiza o <a href={`/curriculo?vaga=${jobId}`}>seu currículo</a>{' '}
          para ela: destaca o que é relevante, usa o vocabulário do anúncio e diz o que a vaga pede e você
          não mostrou. Ela não inventa experiência.
        </p>
        {disponivel ? (
          <BotaoDeAdaptar jobId={jobId} rotulo="Adaptar meu currículo" />
        ) : (
          <p className="erro">A adaptação está desligada neste ambiente.</p>
        )}
        <p className="limite">
          {Math.max(LIMITE_ADAPTACOES - usadas, 0)} de {LIMITE_ADAPTACOES} adaptações restantes hoje.
        </p>
      </div>
      <details className="descricao">
        <summary>Descrição da vaga</summary>
        <p>{vaga.descricao}</p>
      </details>
    </>
  );
}
