import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { adaptacaoDisponivel, lerCurriculo } from '../../../../lib/adaptacao.ts';
import {
  comparacoesHoje,
  lerAcesso,
  lerComparacao,
  limiteDeComparacoes,
  vagaParaComparar,
} from '../../../../lib/mapa.ts';
import { usuarioAtual } from '../../../../lib/supabase.ts';
import { compararAcao, marcarCandidatura, type AvisoDaComparacao } from '../../actions.ts';
import { EnviarComEspera } from '../../botoes.tsx';
import { Resultado } from '../resultado.tsx';

export const dynamic = 'force-dynamic';
// A chamada ao Groq leva de 3 a 20 s; com duas tentativas, cabe com folga.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Comparar com meu currículo',
  robots: { index: false },
};

const TEXTO_DO_AVISO: Record<AvisoDaComparacao, string> = {
  limite: 'Você já usou as comparações de hoje. Amanhã tem mais.',
  cota: 'A IA está no limite agora. Tente de novo em alguns minutos; esta tentativa não contou.',
  falha: 'A comparação falhou. Tente de novo; esta tentativa não contou.',
  indisponivel: 'A comparação está fora do ar no momento.',
  sem_descricao: 'Esta vaga não tem descrição suficiente para comparar.',
};

export default async function PaginaDaComparacao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string }>;
}) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) notFound();

  const usuario = await usuarioAtual();
  if (!usuario || usuario.visitante) redirect('/mapa');
  const acesso = await lerAcesso(usuario.id);
  if (acesso.estado !== 'teste' && acesso.estado !== 'pago') redirect('/mapa');

  const alvo = await vagaParaComparar(jobId);
  if (!alvo) notFound();
  const { vaga, comparavel } = alvo;

  const [curriculo, usadas] = await Promise.all([lerCurriculo(usuario.id), comparacoesHoje(usuario.id)]);
  const comparacao = curriculo ? await lerComparacao(usuario.id, jobId, curriculo.hash) : null;
  const limite = limiteDeComparacoes(acesso);
  const restam = Math.max(0, limite - usadas);

  const codigo = (await searchParams).aviso as AvisoDaComparacao | undefined;
  const aviso = codigo && Object.hasOwn(TEXTO_DO_AVISO, codigo) ? TEXTO_DO_AVISO[codigo] : null;

  return (
    <div className="mapa comparacao">
      <a href="/mapa?aba=vagas" className="fraco">
        ← Voltar ao Mapa
      </a>
      <div>
        <p className="fraco" style={{ margin: 0 }}>
          {vaga.empresa}
        </p>
        <h1>{vaga.cargo}</h1>
      </div>

      {aviso ? (
        <p className="erro" role="status">
          {aviso}
        </p>
      ) : null}

      {comparacao ? (
        <Resultado jobId={jobId} requisitos={comparacao.requisitos} />
      ) : !curriculo ? (
        <div className="caixa">
          <h2 style={{ marginTop: 0 }}>Salve seu currículo uma vez</h2>
          <p className="fraco">
            O Mapa compara cada vaga com o currículo salvo no wagas, o mesmo da adaptação. Depois de salvar, você volta
            para esta vaga.
          </p>
          <a href={`/curriculo?comparar=${jobId}`}>Salvar meu currículo</a>
        </div>
      ) : !comparavel ? (
        <div className="caixa aviso">
          <p style={{ margin: 0 }}>
            Esta vaga não tem descrição suficiente para comparar. Abra a vaga para ver os requisitos no site de origem.
          </p>
        </div>
      ) : (
        <div className="caixa">
          <h2 style={{ marginTop: 0 }}>Quantos requisitos desta vaga você tem?</h2>
          <p className="fraco">
            A IA lê a descrição da vaga e o seu currículo salvo, lista os requisitos e mostra o trecho do seu currículo
            que prova cada um. Restam {restam} de {limite} comparações hoje.
          </p>
          {restam > 0 ? (
            <form action={compararAcao}>
              <input type="hidden" name="job_id" value={jobId} />
              <input type="hidden" name="aba" value="vagas" />
              <EnviarComEspera pendente="Comparando… leva uns 10 segundos">Comparar com meu currículo</EnviarComEspera>
            </form>
          ) : (
            <p style={{ margin: 0 }}>Você já usou as comparações de hoje. Amanhã tem mais.</p>
          )}
        </div>
      )}

      <div className="mapa-acoes">
        <a className="ver-vaga" href={`/ir/${jobId}`} target="_blank" rel="noopener noreferrer">
          Ver vaga <span aria-hidden="true">↗</span>
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
        {comparavel && adaptacaoDisponivel() ? <a href={`/adaptar/${jobId}`}>Adaptar meu currículo a esta vaga</a> : null}
        <form action={marcarCandidatura}>
          <input type="hidden" name="aba" value="vagas" />
          <input type="hidden" name="job_id" value={jobId} />
          <button type="submit" className="discreto">
            Já me candidatei
          </button>
        </form>
      </div>
    </div>
  );
}
