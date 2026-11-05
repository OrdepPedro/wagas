import { redirect } from 'next/navigation';
import { lerCurriculo } from '../../lib/adaptacao.ts';
import { usuarioAtual } from '../../lib/supabase.ts';
import { FormularioDeEntrada } from '../formularios.tsx';
import { apagarCurriculoAcao } from './actions.ts';
import { FormularioDeCurriculo } from './formularios.tsx';

export const dynamic = 'force-dynamic';

export default async function PaginaDoCurriculo({
  searchParams,
}: {
  searchParams: Promise<{ vaga?: string; lido?: string; apagado?: string }>;
}) {
  const usuario = await usuarioAtual();
  if (!usuario) redirect('/');
  const { vaga, lido, apagado } = await searchParams;
  const voltar = vaga && /^\d+$/.test(vaga) ? `/adaptar/${vaga}` : null;

  if (usuario.visitante) {
    return (
      <>
        <h1>Seu currículo</h1>
        <div className="caixa aviso" style={{ marginBottom: 24 }}>
          <p>Para adaptar o currículo às vagas, entre com seu e-mail.</p>
          <p className="fraco" style={{ margin: 0 }}>
            Currículo é dado pessoal: guardamos só para quem tem conta, e você pode apagar quando quiser.
          </p>
        </div>
        <FormularioDeEntrada />
      </>
    );
  }

  const curriculo = await lerCurriculo(usuario.id);

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Seu currículo</h1>
          <p className="fraco" style={{ margin: 0 }}>
            {curriculo
              ? `Salvo em ${new Date(curriculo.atualizadoEm).toLocaleDateString('pt-BR')}${curriculo.origem === 'pdf' ? ', a partir de um arquivo' : ''}.`
              : 'Guarde uma vez e adapte para cada vaga com um clique.'}
          </p>
        </div>
        {voltar ? (
          <a href={voltar} className="link-feed">
            Voltar para a vaga
          </a>
        ) : null}
      </div>

      {lido === 'pdf' ? (
        <div className="caixa boa" style={{ marginBottom: 24 }}>
          <p style={{ margin: 0 }}>
            Li o seu arquivo. Confira o texto abaixo — currículo de duas colunas às vezes sai embaralhado. Se
            corrigir algo, salve de novo.
          </p>
        </div>
      ) : null}
      {apagado ? (
        <div className="caixa boa" style={{ marginBottom: 24 }}>
          <p style={{ margin: 0 }}>Currículo e adaptações apagados.</p>
        </div>
      ) : null}

      <FormularioDeCurriculo texto={curriculo?.texto ?? ''} voltar={voltar} />

      {curriculo ? (
        <div className="rodape">
          <form action={apagarCurriculoAcao}>
            <p>Apagar remove o currículo e o conteúdo de todos os currículos adaptados.</p>
            <button type="submit" className="discreto">
              Apagar meu currículo
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
