import {
  CONTRATOS,
  MODELOS,
  NIVEIS,
  NOME_DO_MOTIVO,
  NOME_DO_NIVEL,
  NOME_DO_STATUS,
  STATUS_VISIVEIS,
  type Aba,
  type Acesso,
  type MotivoDoCorte,
  type PerfilDoMapa,
} from '../../../src/mapa/regras.ts';
import { JANELA_DIAS, type Vaga } from '../../lib/feed.ts';
import type { Candidatura, Pergunta, VagasDoMapa } from '../../lib/mapa.ts';
import type { Perfil } from '../../lib/perfil.ts';
import {
  apagarCandidaturaAcao,
  inserirManualAcao,
  marcarCandidatura,
  mudarStatusAcao,
  responderPergunta,
  salvarFiltros,
} from './actions.ts';

/**
 * As seções do painel do Mapa. A página decide o acesso e busca os dados;
 * aqui só se desenha.
 */

const NOME_DO_MODELO = { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' } as const;
const NOME_DO_CONTRATO = { tanto_faz: 'Tanto faz', clt: 'CLT', pj: 'PJ' } as const;
const EM_ANDAMENTO = new Set(['enviada', 'aguardando', 'entrevista', 'proposta']);
const FUSO = 'America/Sao_Paulo';

const dia = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: FUSO,
  });

function saudacao(agora: Date): string {
  const hora = Number(agora.toLocaleString('pt-BR', { hour: 'numeric', hour12: false, timeZone: FUSO }));
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
}

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;

/* ---------------------------------------------------------------------------
 * Moldura do painel: menu à esquerda, conteúdo, resumo à direita.
 * ------------------------------------------------------------------------- */

export function Lateral({
  aba,
  acesso,
  vagas,
  candidaturas,
}: {
  aba: Aba;
  acesso: Acesso;
  vagas: number | null;
  candidaturas: number;
}) {
  const itens: { aba: Aba; nome: string; icone: string; conta?: number | null }[] = [
    { aba: 'geral', nome: 'Visão geral', icone: '▦' },
    { aba: 'vagas', nome: 'Vagas', icone: '◎', conta: vagas },
    { aba: 'candidaturas', nome: 'Candidaturas', icone: '✓', conta: candidaturas },
    { aba: 'filtros', nome: 'Filtros', icone: '≡' },
  ];
  return (
    <aside className="painel-lateral">
      <p className="painel-rotulo">Seu mapa</p>
      <nav aria-label="Seções do Mapa">
        <ul>
          {itens.map((i) => (
            <li key={i.aba}>
              <a
                href={i.aba === 'geral' ? '/mapa' : `/mapa?aba=${i.aba}`}
                aria-current={aba === i.aba ? 'page' : undefined}
              >
                <span className="painel-icone" aria-hidden="true">
                  {i.icone}
                </span>
                {i.nome}
                {i.conta ? <span className="painel-conta">{i.conta}</span> : null}
              </a>
            </li>
          ))}
          <li>
            <a href="/curriculo">
              <span className="painel-icone" aria-hidden="true">
                ▤
              </span>
              Meu currículo
            </a>
          </li>
        </ul>
      </nav>
      <Assinatura acesso={acesso} />
    </aside>
  );
}

function Assinatura({ acesso }: { acesso: Acesso }) {
  if (acesso.estado === 'pago') {
    return (
      <div className="painel-teste">
        <strong>
          <span className="painel-ponto ok" aria-hidden="true" /> Assinatura ativa
        </strong>
      </div>
    );
  }
  if (acesso.estado !== 'teste') return null;
  const { horasRestantes } = acesso;
  const resta = horasRestantes > 24 ? plural(Math.ceil(horasRestantes / 24), 'dia', 'dias') : `${horasRestantes} h`;
  return (
    <div className="painel-teste">
      <strong>
        <span className="painel-ponto" aria-hidden="true" /> Teste gratuito
      </strong>
      <span>
        Faltam {resta}, até {dia(acesso.ate.toISOString())}
      </span>
    </div>
  );
}

export function Resumo({ perfil, dados, candidaturas }: { perfil: Perfil | null; dados: VagasDoMapa | null; candidaturas: Candidatura[] }) {
  const feitas = candidaturas.filter((c) => c.status !== 'nao_enviada').length;
  const linhas: [string, number | null][] = dados
    ? [
        ['Para analisar', dados.visiveis.length],
        ['Recolhidas pelos filtros', dados.recolhidas.length],
        ['Já candidatadas', dados.jaCandidatadas],
        ['De outra área', dados.outraArea],
        ['Candidaturas feitas', feitas],
      ]
    : [['Candidaturas feitas', feitas]];

  return (
    <aside className="painel-direita">
      <section className="painel-cartao">
        <h2>Busca diária</h2>
        {perfil ? (
          <p className="fraco painel-busca">
            {perfil.cargo} · {perfil.soRemoto ? 'remoto, todo o Brasil' : `${perfil.cidade} e remoto`}
          </p>
        ) : null}
        <dl className="painel-numeros">
          {linhas.map(([nome, valor]) => (
            <div key={nome}>
              <dt>{nome}</dt>
              <dd>{valor === null ? '—' : valor.toLocaleString('pt-BR')}</dd>
            </div>
          ))}
        </dl>
        <p className="fraco painel-nota">Vagas publicadas nos últimos {JANELA_DIAS} dias.</p>
        <a className="painel-botao" href={perfil ? '/mapa?aba=vagas' : '/'}>
          {perfil ? 'Abrir vagas' : 'Escolher cargo e cidade'}
        </a>
        {perfil ? (
          <a className="painel-link" href="/vagas">
            Trocar cargo ou cidade
          </a>
        ) : null}
      </section>

      <section className="painel-cartao">
        <h2>Seu currículo</h2>
        <p className="fraco">
          Em breve o Mapa compara cada vaga com o seu currículo: quantos requisitos você tem e o que falta.
        </p>
        <a className="painel-link" href="/curriculo">
          Revisar currículo
        </a>
      </section>
    </aside>
  );
}

/* ---------------------------------------------------------------------------
 * Visão geral
 * ------------------------------------------------------------------------- */

function Destaque({ perfil, dados, agora }: { perfil: Perfil | null; dados: VagasDoMapa | null; agora: Date }) {
  const data = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FUSO });
  const n = dados?.visiveis.length ?? 0;
  return (
    <section className="painel-destaque">
      <p className="painel-sobretitulo">
        Mapa do dia <span aria-hidden="true" /> {data}
      </p>
      <h1>
        {perfil && n > 0 ? 'Vagas na mesa' : 'Mesa limpa'}
        <span className="painel-pingo">.</span>
      </h1>
      <p>
        {saudacao(agora)}.{' '}
        {!perfil
          ? 'Diga o cargo e a cidade e o Mapa separa as vagas da semana para você.'
          : n > 0
            ? `O Mapa separou ${plural(n, 'vaga', 'vagas')} de ${perfil.cargo} para você. Escolha onde vale colocar sua energia hoje.`
            : `Nenhuma vaga nova de ${perfil.cargo} passou pelos seus filtros. Confira as recolhidas ou ajuste os filtros.`}
      </p>
    </section>
  );
}

function Numeros({ dados, candidaturas }: { dados: VagasDoMapa | null; candidaturas: Candidatura[] }) {
  const andamento = candidaturas.filter((c) => EM_ANDAMENTO.has(c.status));
  const entrevistas = andamento.filter((c) => c.status === 'entrevista' || c.status === 'proposta').length;
  const recolhidas = dados?.recolhidas.length ?? 0;
  const motivos = dados ? (Object.keys(dados.contagem) as MotivoDoCorte[]).filter((m) => dados.contagem[m] > 0) : [];

  return (
    <div className="painel-numeros-grandes">
      <a href="/mapa?aba=vagas" className="painel-numero destaque">
        <span className="painel-numero-nome">Vagas</span>
        <strong>{dados?.visiveis.length ?? 0}</strong>
        <span>para analisar · últimos {JANELA_DIAS} dias</span>
      </a>
      <a href="/mapa?aba=candidaturas" className="painel-numero">
        <span className="painel-numero-nome">Candidaturas</span>
        <strong>{andamento.length}</strong>
        <span>em andamento · {plural(entrevistas, 'em entrevista ou proposta', 'em entrevista ou proposta')}</span>
      </a>
      <a href="/mapa?aba=vagas#recolhidas" className="painel-numero">
        <span className="painel-numero-nome">Recolhidas</span>
        <strong>{recolhidas}</strong>
        <span>
          {motivos.length > 0
            ? motivos.map((m) => `${dados!.contagem[m]} ${NOME_DO_MOTIVO[m].toLowerCase()}`).join(' · ')
            : 'pelos seus filtros'}
        </span>
      </a>
    </div>
  );
}

function LinhaDeVaga({ vaga }: { vaga: Vaga }) {
  const empresa = vaga.empresa === 'não identificada' ? 'Empresa não identificada' : vaga.empresa;
  return (
    <li>
      <div>
        <a className="painel-lista-titulo" href={`/ir/${vaga.id}`} target="_blank" rel="noopener noreferrer">
          {vaga.cargo}
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
        <p className="fraco">
          {empresa}
          {vaga.localizacao ? ` · ${vaga.localizacao}` : ''}
          {vaga.modelo ? ` · ${NOME_DO_MODELO[vaga.modelo]}` : ''}
        </p>
      </div>
      <span className="painel-data">
        {vaga.data_publicacao ? dia(vaga.data_publicacao) : `vista ${dia(vaga.data_referencia)}`}
      </span>
    </li>
  );
}

function LinhaDeCandidatura({ c }: { c: Candidatura }) {
  return (
    <li>
      <div>
        <span className="painel-lista-titulo">{c.cargo}</span>
        <p className="fraco">
          {c.empresa} · enviada em {dia(c.enviada_em)}
        </p>
      </div>
      <span className={`painel-status status-${c.status}`}>{c.status === 'nao_enviada' ? 'Não enviada' : NOME_DO_STATUS[c.status]}</span>
    </li>
  );
}

function CabecalhoDeLista({ titulo, href, link }: { titulo: string; href?: string; link?: string }) {
  return (
    <div className="painel-cabecalho">
      <h2>{titulo}</h2>
      {href && link ? <a href={href}>{link}</a> : null}
    </div>
  );
}

export function VisaoGeral({
  perfil,
  dados,
  candidaturas,
  perguntas,
  agora,
}: {
  perfil: Perfil | null;
  dados: VagasDoMapa | null;
  candidaturas: Candidatura[];
  perguntas: Pergunta[];
  agora: Date;
}) {
  const recomendadas = dados?.visiveis.slice(0, 5) ?? [];
  const recentes = candidaturas.filter((c) => c.status !== 'nao_enviada').slice(0, 3);
  return (
    <>
      <Destaque perfil={perfil} dados={dados} agora={agora} />
      <Perguntas perguntas={perguntas} />
      <Numeros dados={dados} candidaturas={candidaturas} />

      <section>
        <CabecalhoDeLista
          titulo="Vagas recomendadas"
          href="/mapa?aba=vagas"
          link={dados && dados.visiveis.length > 0 ? `Ver todas as vagas (${dados.visiveis.length})` : undefined}
        />
        {recomendadas.length > 0 ? (
          <ul className="painel-lista">
            {recomendadas.map((v) => (
              <LinhaDeVaga key={v.id} vaga={v} />
            ))}
          </ul>
        ) : (
          <Vazio
            titulo={perfil ? 'Nenhuma vaga para analisar' : 'Nenhuma busca feita ainda'}
            texto={
              perfil ? (
                <>
                  Veja as recolhidas em <a href="/mapa?aba=vagas#recolhidas">Vagas</a> ou ajuste os{' '}
                  <a href="/mapa?aba=filtros">filtros</a>.
                </>
              ) : (
                <>
                  <a href="/">Diga o cargo e a cidade</a> e as vagas aparecem aqui.
                </>
              )
            }
          />
        )}
      </section>

      <section>
        <CabecalhoDeLista titulo="Candidaturas recentes" href="/mapa?aba=candidaturas" link="Ver todas" />
        {recentes.length > 0 ? (
          <ul className="painel-lista">
            {recentes.map((c) => (
              <LinhaDeCandidatura key={c.id} c={c} />
            ))}
          </ul>
        ) : (
          <Vazio
            titulo="Nenhuma candidatura registrada"
            texto={
              <>
                Marque “Já me candidatei” numa vaga ou{' '}
                <a href="/mapa?aba=candidaturas#adicionar">adicione uma feita fora do wagas</a>.
              </>
            }
          />
        )}
      </section>
    </>
  );
}

function Vazio({ titulo, texto }: { titulo: string; texto: React.ReactNode }) {
  return (
    <div className="painel-vazio">
      <strong>{titulo}</strong>
      <p className="fraco">{texto}</p>
    </div>
  );
}

function Perguntas({ perguntas }: { perguntas: Pergunta[] }) {
  if (perguntas.length === 0) return null;
  return (
    <section className="painel-cartao painel-perguntas">
      <h2>Você se candidatou?</h2>
      <p className="fraco">Você abriu estas vagas nos últimos dias.</p>
      <ul>
        {perguntas.map((p) => (
          <li key={p.jobId}>
            <span>
              <strong>{p.cargo}</strong> · {p.empresa}
            </span>
            <form action={responderPergunta}>
              <input type="hidden" name="job_id" value={p.jobId} />
              <button type="submit" name="resposta" value="sim">
                Sim
              </button>
              <button type="submit" name="resposta" value="nao" className="discreto">
                Não
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Vagas
 * ------------------------------------------------------------------------- */

function CartaoDoMapa({ vaga, motivo }: { vaga: Vaga; motivo?: MotivoDoCorte }) {
  return (
    <li className="vaga">
      <p className="empresa">{vaga.empresa === 'não identificada' ? <em>empresa não identificada</em> : vaga.empresa}</p>
      <a className="titulo" href={`/ir/${vaga.id}`} target="_blank" rel="noopener noreferrer">
        {vaga.cargo}
      </a>
      {vaga.localizacao ? <p className="local">{vaga.localizacao}</p> : null}
      <div className="etiquetas">
        {motivo ? <span className="etiqueta incerta">{NOME_DO_MOTIVO[motivo]}</span> : null}
        {vaga.modelo ? <span className="etiqueta">{NOME_DO_MODELO[vaga.modelo]}</span> : null}
        {vaga.senioridade ? <span className="etiqueta">{vaga.senioridade}</span> : null}
        {vaga.tipo_contrato ? <span className="etiqueta">{vaga.tipo_contrato.split(/\s+-\s+/)[0]}</span> : null}
        <span className="etiqueta">
          {vaga.data_publicacao ? `publicada em ${dia(vaga.data_publicacao)}` : `vista em ${dia(vaga.data_referencia)}`}
        </span>
      </div>
      <div className="mapa-acoes">
        <a className="ver-vaga" href={`/ir/${vaga.id}`} target="_blank" rel="noopener noreferrer">
          Ver vaga <span aria-hidden="true">↗</span>
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
        <form action={marcarCandidatura}>
          <input type="hidden" name="aba" value="vagas" />
          <input type="hidden" name="job_id" value={vaga.id} />
          <button type="submit" className="discreto">
            Já me candidatei
          </button>
        </form>
      </div>
    </li>
  );
}

export function Vagas({ perfil, dados }: { perfil: Perfil | null; dados: VagasDoMapa | null }) {
  if (!perfil || !dados) {
    return (
      <Vazio
        titulo="Nenhuma busca feita ainda"
        texto={
          <>
            <a href="/">Diga o cargo e a cidade</a> e as vagas aparecem aqui.
          </>
        }
      />
    );
  }
  const { visiveis, recolhidas, contagem, jaCandidatadas, outraArea } = dados;
  const motivos = (Object.keys(contagem) as MotivoDoCorte[]).filter((m) => contagem[m] > 0);

  return (
    <section>
      <div className="painel-cabecalho">
        <h1>
          Vagas para analisar <span className="fraco">({visiveis.length})</span>
        </h1>
      </div>
      <p className="fraco">
        {perfil.cargo} · {perfil.soRemoto ? 'remoto em todo o Brasil' : `${perfil.cidade} e remoto no Brasil`} · últimos{' '}
        {JANELA_DIAS} dias. <a href="/vagas">Trocar cargo ou cidade</a>
      </p>

      {/* O painel de cortes: quantas saíram da frente, e por quê. */}
      <ul className="mapa-cortes">
        {motivos.map((m) => (
          <li key={m}>
            <strong>{contagem[m]}</strong> {NOME_DO_MOTIVO[m]}
          </li>
        ))}
        {jaCandidatadas > 0 ? (
          <li>
            <strong>{jaCandidatadas}</strong> em que você já se candidatou
          </li>
        ) : null}
        {outraArea !== null && outraArea > 0 ? (
          <li>
            <strong>{outraArea.toLocaleString('pt-BR')}</strong> de outra área, fora da busca
          </li>
        ) : null}
      </ul>

      {visiveis.length === 0 ? (
        <Vazio
          titulo="Nenhuma vaga para analisar"
          texto={
            recolhidas.length > 0
              ? 'Todas as vagas desta busca ficaram recolhidas pelos seus filtros. Elas estão logo abaixo.'
              : `Nenhuma vaga nova para esta busca nos últimos ${JANELA_DIAS} dias.`
          }
        />
      ) : (
        <ul className="vagas">
          {visiveis.slice(0, 30).map((v) => (
            <CartaoDoMapa key={v.id} vaga={v} />
          ))}
        </ul>
      )}
      {visiveis.length > 30 ? (
        <p className="fraco">
          Mostrando 30 de {visiveis.length}. O restante está em <a href="/vagas">Minhas vagas</a>.
        </p>
      ) : null}

      {recolhidas.length > 0 ? (
        <details className="mapa-recolhidas" id="recolhidas">
          <summary>
            {plural(recolhidas.length, 'vaga recolhida', 'vagas recolhidas')} pelos seus filtros
          </summary>
          <ul className="vagas">
            {recolhidas.slice(0, 50).map(({ vaga, motivo }) => (
              <CartaoDoMapa key={vaga.id} vaga={vaga} motivo={motivo} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Candidaturas
 * ------------------------------------------------------------------------- */

export function Candidaturas({ candidaturas }: { candidaturas: Candidatura[] }) {
  const lista = candidaturas.filter((c) => c.status !== 'nao_enviada');
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });

  return (
    <section>
      <div className="painel-cabecalho">
        <h1>
          Suas candidaturas <span className="fraco">({lista.length})</span>
        </h1>
      </div>
      {lista.length === 0 ? (
        <Vazio
          titulo="Nada registrado ainda"
          texto="Marque “Já me candidatei” numa vaga ou adicione abaixo uma candidatura feita fora do wagas."
        />
      ) : (
        <ul className="mapa-candidaturas">
          {lista.map((c) => (
            <li key={c.id} className="vaga">
              <div>
                <p className="empresa">{c.empresa}</p>
                {c.url ? (
                  <a
                    className="titulo"
                    href={c.job_id ? `/ir/${c.job_id}` : c.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {c.cargo}
                  </a>
                ) : (
                  <span className="titulo">{c.cargo}</span>
                )}
                <p className="fraco" style={{ margin: 0 }}>
                  enviada em {dia(c.enviada_em)}
                  {c.origem === 'manual' ? ' · adicionada à mão' : ''}
                </p>
              </div>
              <div className="mapa-acoes">
                <form action={mudarStatusAcao}>
                  <input type="hidden" name="aba" value="candidaturas" />
                  <input type="hidden" name="id" value={c.id} />
                  <label className="sr-only" htmlFor={`status-${c.id}`}>
                    Status
                  </label>
                  <select id={`status-${c.id}`} name="status" defaultValue={c.status}>
                    {STATUS_VISIVEIS.map((s) => (
                      <option key={s} value={s}>
                        {NOME_DO_STATUS[s]}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="discreto">
                    Salvar
                  </button>
                </form>
                <form action={apagarCandidaturaAcao}>
                  <input type="hidden" name="aba" value="candidaturas" />
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="discreto">
                    Apagar
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={inserirManualAcao} className="painel-cartao mapa-manual" id="adicionar">
        <h2>Adicionar candidatura feita fora do wagas</h2>
        <input type="hidden" name="aba" value="candidaturas" />
        <div className="campos duplo">
          <div>
            <label htmlFor="m-cargo">Cargo</label>
            <input id="m-cargo" name="cargo" type="text" required maxLength={120} />
          </div>
          <div>
            <label htmlFor="m-empresa">Empresa</label>
            <input id="m-empresa" name="empresa" type="text" required maxLength={120} />
          </div>
          <div>
            <label htmlFor="m-url">Link da vaga (opcional)</label>
            <input id="m-url" name="url" type="text" inputMode="url" placeholder="https://" maxLength={500} />
          </div>
          <div>
            <label htmlFor="m-data">Enviada em</label>
            <input id="m-data" name="enviada_em" type="date" defaultValue={hoje} max={hoje} />
          </div>
          <div>
            <label htmlFor="m-status">Status</label>
            <select id="m-status" name="status" defaultValue="enviada">
              {STATUS_VISIVEIS.map((s) => (
                <option key={s} value={s}>
                  {NOME_DO_STATUS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit">Adicionar</button>
      </form>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Filtros
 * ------------------------------------------------------------------------- */

export function Filtros({ filtros }: { filtros: PerfilDoMapa }) {
  return (
    <section>
      <div className="painel-cabecalho">
        <h1>Seus filtros</h1>
      </div>
      <p className="fraco">O que não passa nos filtros fica recolhido em Vagas, com o motivo. Nada é apagado.</p>
      <form action={salvarFiltros} className="painel-cartao mapa-filtros">
        <input type="hidden" name="aba" value="filtros" />
        <div className="campos duplo">
          <div>
            <label htmlFor="nivel">Seu nível</label>
            <select id="nivel" name="nivel" defaultValue={filtros.nivel ?? ''}>
              <option value="">Não filtrar</option>
              {NIVEIS.map((n) => (
                <option key={n} value={n}>
                  {NOME_DO_NIVEL[n]}
                </option>
              ))}
            </select>
            <small className="fraco">Vaga acima do seu nível fica recolhida.</small>
          </div>
          <div>
            <label htmlFor="contrato">Contrato</label>
            <select id="contrato" name="contrato" defaultValue={filtros.contrato}>
              {CONTRATOS.map((c) => (
                <option key={c} value={c}>
                  {NOME_DO_CONTRATO[c]}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend>Modelos que você aceita</legend>
            {MODELOS.map((m) => (
              <label key={m} className="mapa-marca">
                <input type="checkbox" name="modelos" value={m} defaultChecked={filtros.modelos.includes(m)} />
                {NOME_DO_MODELO[m]}
              </label>
            ))}
            <small className="fraco">Nenhum marcado = todos.</small>
          </fieldset>
          <div>
            <label htmlFor="pretensao">Quanto você quer ganhar (R$ por mês)</label>
            <input
              id="pretensao"
              name="pretensao"
              type="text"
              inputMode="numeric"
              placeholder="3500"
              defaultValue={filtros.pretensao ?? ''}
            />
            <small className="fraco">Fica guardado. Ainda não corta vaga: o acervo não tem salário.</small>
          </div>
        </div>
        <button type="submit">Salvar filtros</button>
      </form>
    </section>
  );
}

