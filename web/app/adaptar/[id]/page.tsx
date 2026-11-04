import { redirect } from 'next/navigation';
import { vagaAdaptavel, type CurriculoAdaptado } from '../../../../src/curriculo/adaptar.ts';
import {
  adaptacaoDisponivel,
  adaptacoesHoje,
  lerAdaptacao,
  lerCurriculo,
  LIMITE_ADAPTACOES,
  type Adaptacao,
} from '../../../lib/adaptacao.ts';
import { clienteDoServidor, usuarioAtual } from '../../../lib/supabase.ts';
import { FormularioDeEntrada } from '../../formularios.tsx';
import { BotaoDeAdaptar } from '../../curriculo/formularios.tsx';

export const dynamic = 'force-dynamic';

function Previa({ cv }: { cv: CurriculoAdaptado }) {
  return (
    <article className="cv">
      <h2>{cv.nome}</h2>
      {cv.titulo ? <p className="cv-titulo">{cv.titulo}</p> : null}
      {cv.contato.length > 0 ? <p className="fraco">{cv.contato.join(' · ')}</p> : null}
      {cv.resumo ? (
        <>
          <h3>Resumo</h3>
          <p>{cv.resumo}</p>
        </>
      ) : null}
      {cv.experiencias.length > 0 ? <h3>Experiência</h3> : null}
      {cv.experiencias.map((e, i) => (
        <div key={i} className="cv-bloco">
          <strong>{[e.cargo, e.empresa].filter(Boolean).join(' — ')}</strong>
          {e.periodo ? <span className="fraco"> · {e.periodo}</span> : null}
          <ul>
            {e.itens.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
      {cv.formacao.length > 0 ? <h3>Formação</h3> : null}
      {cv.formacao.map((f, i) => (
        <p key={i}>
          <strong>{[f.curso, f.instituicao].filter(Boolean).join(' — ')}</strong>
          {f.periodo ? <span className="fraco"> · {f.periodo}</span> : null}
        </p>
      ))}
      {cv.habilidades.length > 0 ? (
        <>
          <h3>Habilidades</h3>
          <p>{cv.habilidades.join(' · ')}</p>
        </>
      ) : null}
      {cv.certificacoes.length > 0 ? (
        <>
          <h3>Certificações</h3>
          <p>{cv.certificacoes.join(' · ')}</p>
        </>
      ) : null}
      {cv.idiomas.length > 0 ? (
        <>
          <h3>Idiomas</h3>
          <p>{cv.idiomas.join(' · ')}</p>
        </>
      ) : null}
    </article>
  );
}

function Resultado({ jobId, adaptacao }: { jobId: number; adaptacao: Adaptacao }) {
  const { resultado: cv, alertas } = adaptacao;
  return (
    <>
      <div className="acoes-cv">
        <a className="botao" href={`/adaptar/${jobId}/pdf`}>
          Baixar PDF
        </a>
        {/* Pelo /ir para o clique contar: CV gerado → foi para a vaga é a métrica do diferencial. */}
        <a className="link-feed" href={`/ir/${jobId}`} target="_blank" rel="noopener noreferrer">
          Ver vaga e se candidatar
        </a>
      </div>

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
            currículo original:
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
            Se não for verdade, não envie: corrija o currículo salvo e adapte de novo.
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
            Ficou fora do currículo de propósito — não inventamos experiência. Se você tem, acrescente ao
            currículo salvo; se não tem, vale preparar a resposta para a entrevista.
          </p>
          <ul>
            {cv.lacunas.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Previa cv={cv} />
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
        <Resultado jobId={jobId} adaptacao={adaptacao} />
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
