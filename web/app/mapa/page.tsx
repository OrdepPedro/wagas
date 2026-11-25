import type { Metadata } from 'next';
import { TRIAL_DIAS, ehAba, type Aba } from '../../../src/mapa/regras.ts';
import { lerCurriculo } from '../../lib/adaptacao.ts';
import {
  lerAcesso,
  lerCandidaturas,
  lerPerfilDoMapa,
  perguntasPendentes,
  placaresDoCurriculo,
  vagasDoMapa,
} from '../../lib/mapa.ts';
import { lerPerfil } from '../../lib/perfil.ts';
import { usuarioAtual } from '../../lib/supabase.ts';
import { lerAlertas } from '../../lib/alertas.ts';
import { comecarTeste, type Aviso } from './actions.ts';
import { Alertas, Candidaturas, Filtros, Lateral, Resumo, Vagas, VisaoGeral } from './painel.tsx';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mapa de candidaturas',
  description: 'Suas vagas filtradas por nível, modelo e contrato, e o registro do que você já enviou.',
  robots: { index: false },
};

const TEXTO_DO_AVISO: Record<Aviso, { texto: string; ruim?: boolean }> = {
  salvo: { texto: 'Salvo.' },
  candidatura: { texto: 'Candidatura registrada. A vaga saiu da sua lista.' },
  falha: { texto: 'Não consegui salvar. Tente de novo.', ruim: true },
  manual_invalida: { texto: 'Confira cargo, empresa, link e data da candidatura.', ruim: true },
  travado: { texto: 'Seu teste do Mapa terminou.', ruim: true },
  alerta_invalido: { texto: 'Confira o cargo e a cidade, ou marque "Só vagas remotas".', ruim: true },
  alerta_repetido: { texto: 'Essa busca já está nos seus alertas.', ruim: true },
  alerta_limite: { texto: 'São até 5 buscas extras. Tire uma para pôr outra.', ruim: true },
};

/* ---------------------------------------------------------------------------
 * Portas: quem não entrou, não começou o teste, ou já o esgotou.
 * ------------------------------------------------------------------------- */

function Porta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mapa">
      <h1>Mapa de candidaturas</h1>
      <div className="caixa">
        <h2 style={{ marginTop: 0 }}>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

function OQueE() {
  return (
    <ul className="fraco">
      <li>Suas vagas com filtro de nível, modelo de trabalho e contrato. O que é cortado fica recolhido, com o motivo.</li>
      <li>O registro do que você já enviou, para a mesma vaga não aparecer duas vezes.</li>
      <li>O Mapa não se candidata por você: a candidatura é sua, no site da empresa.</li>
    </ul>
  );
}

/* ---------------------------------------------------------------------------
 * Página
 * ------------------------------------------------------------------------- */

export default async function PaginaDoMapa({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string; aba?: string; status?: string }>;
}) {
  const usuario = await usuarioAtual();

  if (!usuario || usuario.visitante) {
    return (
      <Porta titulo="Entre com seu e-mail para usar o Mapa">
        <OQueE />
        <p>
          São {TRIAL_DIAS} dias de teste, sem cartão. <a href="/entrar">Entrar</a>
        </p>
      </Porta>
    );
  }

  const acesso = await lerAcesso(usuario.id);

  if (acesso.estado === 'indisponivel') {
    return (
      <Porta titulo="O Mapa ainda não está ligado">
        <p className="fraco">Estamos terminando de preparar. Volte em breve.</p>
      </Porta>
    );
  }

  if (acesso.estado === 'sem_teste') {
    return (
      <Porta titulo={`Teste o Mapa por ${TRIAL_DIAS} dias`}>
        <OQueE />
        <p className="fraco">Sem cartão. Depois dos {TRIAL_DIAS} dias o Mapa trava; a busca de vagas continua gratuita.</p>
        <form action={comecarTeste}>
          <button type="submit">Começar teste gratuito</button>
        </form>
      </Porta>
    );
  }

  if (acesso.estado === 'expirado') {
    const guardadas = (await lerCandidaturas(usuario.id)).filter((c) => c.status !== 'nao_enviada').length;
    return (
      <Porta titulo="Seu teste do Mapa terminou">
        <p>
          {guardadas > 0
            ? `Suas ${guardadas} candidaturas continuam guardadas e voltam quando você assinar.`
            : 'O Mapa está travado até você assinar.'}
        </p>
        <p className="fraco">A assinatura ainda não está aberta. A busca de vagas continua gratuita.</p>
        <a href="/vagas">Ir para minhas vagas</a>
      </Porta>
    );
  }

  const params = await searchParams;
  const aba: Aba = ehAba(params.aba) ? params.aba : 'geral';
  const codigo = params.aviso as Aviso | undefined;
  const aviso = codigo && Object.hasOwn(TEXTO_DO_AVISO, codigo) ? TEXTO_DO_AVISO[codigo] : null;

  const [perfil, filtros, candidaturas, curriculo] = await Promise.all([
    lerPerfil(usuario.id),
    lerPerfilDoMapa(usuario.id),
    lerCandidaturas(usuario.id),
    lerCurriculo(usuario.id),
  ]);
  // Sem a 0024 aplicada a consulta falha e volta vazia: as vagas aparecem sem placar.
  const placares = curriculo ? await placaresDoCurriculo(usuario.id, curriculo.hash) : new Map();
  const [dados, perguntas, alertas] = await Promise.all([
    perfil ? vagasDoMapa(perfil, filtros, candidaturas) : Promise.resolve(null),
    aba === 'geral'
      ? perguntasPendentes(usuario.id, new Set(candidaturas.flatMap((c) => (c.job_id ? [c.job_id] : []))))
      : Promise.resolve([]),
    aba === 'alertas' ? lerAlertas(usuario.id) : Promise.resolve(null),
  ]);
  const agora = new Date();
  const feitas = candidaturas.filter((c) => c.status !== 'nao_enviada').length;

  return (
    <div className="painel">
      <Lateral aba={aba} acesso={acesso} vagas={dados?.visiveis.length ?? null} candidaturas={feitas} />

      <div className="painel-centro">
        {aviso ? (
          <p className={aviso.ruim ? 'erro' : 'mapa-ok'} role="status">
            {aviso.texto}
          </p>
        ) : null}

        {aba === 'geral' ? (
          <VisaoGeral perfil={perfil} dados={dados} candidaturas={candidaturas} perguntas={perguntas} agora={agora} placares={placares} />
        ) : aba === 'vagas' ? (
          <Vagas perfil={perfil} dados={dados} placares={placares} />
        ) : aba === 'candidaturas' ? (
          <Candidaturas candidaturas={candidaturas} status={params.status} />
        ) : aba === 'alertas' && alertas ? (
          <Alertas perfil={perfil} alertas={alertas} email={usuario.email} />
        ) : (
          <Filtros filtros={filtros} />
        )}
      </div>

      <Resumo perfil={perfil} dados={dados} candidaturas={candidaturas} />
    </div>
  );
}
