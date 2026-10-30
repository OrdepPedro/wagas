'use client';

import { useActionState, useState } from 'react';

import {
  AVISO_GUPY,
  CHECKLIST,
  type Estrutura,
  type EstruturaGupy,
  type EstruturaLinkedin,
  type ExperienciaEstruturada,
  type Plataforma,
} from '../../../../src/curriculo/plataformas.ts';
import { Check } from '../../check.tsx';
import { estruturar, registrarFeedback, type EstadoDaEstruturacao } from './acoes.ts';

const OPCOES: Record<Plataforma, { nome: string; artigo: 'o' | 'a'; objetivo: string; explicacao: string; entrega: string }> = {
  linkedin: {
    nome: 'LinkedIn',
    artigo: 'o',
    objetivo: 'Ser encontrado',
    explicacao:
      'No LinkedIn é o recrutador que procura você. A busca dele lê headline, Sobre, experiências e competências: o perfil precisa aparecer para o cargo certo e convencer quem o abre.',
    entrega: '2 opções de headline, Sobre, experiências reescritas e competências priorizadas.',
  },
  gupy: {
    nome: 'Gupy',
    artigo: 'a',
    objetivo: 'Ser bem ordenado',
    explicacao:
      'Na Gupy você se candidata, e a plataforma ordena as candidaturas principalmente pelos campos Experiência e Habilidades. Eles precisam mostrar, em contexto, o que você fez e com quê.',
    entrega: 'Texto de cada experiência pronto para colar, até 30 habilidades e o "Apresente-se".',
  },
};

export function Estruturador() {
  const [plataforma, setPlataforma] = useState<Plataforma>('linkedin');
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [estado, enviar, gerando] = useActionState<EstadoDaEstruturacao, FormData>(async (anterior, dados) => {
    const proximo = await estruturar(anterior, dados);
    // Mesmo motivo do medidor: o React limpa o input de arquivo com o formulário.
    setArquivo(null);
    return proximo;
  }, {});
  const [colar, setColar] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  // Controlados para sobreviver ao reset do formulário: quem gera para o
  // LinkedIn e depois para a Gupy não deveria redigitar nada.
  const [cargo, setCargo] = useState('');
  const [vaga, setVaga] = useState('');
  const [texto, setTexto] = useState('');
  const mostrarTexto = colar || Boolean(estado.pedirTexto);
  const opcao = OPCOES[plataforma];

  return (
    <>
      <form action={enviar} className="hero-busca medidor-form">
        <div className="seletor" role="radiogroup" aria-label="Plataforma">
          {(Object.keys(OPCOES) as Plataforma[]).map((p) => (
            <label key={p} className={`seletor-opcao${plataforma === p ? ' ativa' : ''}`}>
              <input
                type="radio"
                name="plataforma"
                value={p}
                checked={plataforma === p}
                onChange={() => setPlataforma(p)}
              />
              {OPCOES[p].nome}
            </label>
          ))}
        </div>

        <div className="seletor-explicacao" aria-live="polite">
          <p className="seletor-objetivo">{opcao.objetivo}</p>
          <p>{opcao.explicacao}</p>
          <p className="fraco">Você recebe: {opcao.entrega}</p>
        </div>

        {mostrarTexto ? (
          <>
            <label htmlFor="est-texto">Texto do currículo</label>
            <textarea
              id="est-texto"
              name="texto"
              rows={10}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Cole aqui o currículo inteiro"
            />
          </>
        ) : (
          <div
            className={`soltar${arrastando ? ' arrastando' : ''}${arquivo ? ' com-arquivo' : ''}`}
            onDragEnter={() => setArrastando(true)}
            onDragLeave={() => setArrastando(false)}
            onDrop={() => setArrastando(false)}
          >
            <input
              id="est-arquivo"
              name="arquivo"
              type="file"
              required
              aria-label="Currículo em PDF ou DOCX"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setArquivo(e.target.files?.[0]?.name ?? null)}
            />
            <span className="soltar-icone" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28">
                <path
                  d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            {arquivo ? (
              <>
                <strong className="soltar-titulo">{arquivo}</strong>
                <span className="soltar-acao">trocar arquivo</span>
              </>
            ) : (
              <>
                <strong className="soltar-titulo">Arraste seu currículo aqui</strong>
                <span className="soltar-acao">ou escolha um arquivo</span>
                <span className="fraco">PDF ou DOCX · até 5 MB</span>
              </>
            )}
          </div>
        )}
        <button type="button" className="discreto alternar-entrada" onClick={() => setColar(!mostrarTexto)}>
          {mostrarTexto ? 'Enviar arquivo em vez de colar' : 'Prefiro colar o texto'}
        </button>

        <label htmlFor="est-cargo">Cargo que você busca</label>
        <input
          id="est-cargo"
          name="cargo"
          type="text"
          required
          value={cargo}
          onChange={(e) => setCargo(e.target.value)}
          placeholder="Ex.: Analista de Dados"
        />

        {plataforma === 'gupy' ? (
          <>
            <label htmlFor="est-vaga">Descrição da vaga (opcional)</label>
            <textarea
              id="est-vaga"
              name="vaga"
              rows={5}
              value={vaga}
              onChange={(e) => setVaga(e.target.value)}
              placeholder='Cole a vaga para personalizar o "Apresente-se" para ela. Sem vaga, escrevemos para o cargo.'
            />
          </>
        ) : null}

        {estado.erro ? <p className="erro">{estado.erro}</p> : null}

        <button type="submit" disabled={gerando}>
          {gerando ? 'Gerando… pode levar até 30 segundos' : `Estruturar para ${opcao.artigo} ${opcao.nome}`}
        </button>
      </form>

      <ul className="garantias" aria-label="O que você precisa saber">
        <li>
          <Check />
          Lido em memória e descartado
        </li>
        <li>
          <Check />
          Nada é inventado
        </li>
        <li>
          <Check />
          Grátis
        </li>
      </ul>
      <p className="fraco medidor-ressalva">
        Não guardamos o currículo nem o texto gerado. Onde um número fortaleceria o texto e o currículo não traz,
        deixamos um marcador como [X%] para você preencher.
      </p>

      {estado.resultado ? <Resultado resultado={estado.resultado} id={estado.id} /> : null}
    </>
  );
}

function Copiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sem permissão de área de transferência: o texto continua selecionável.
    }
  }
  return (
    <button type="button" className="discreto estrutura-copiar" onClick={copiar}>
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

function Bloco({ titulo, texto, nota }: { titulo: string; texto: string; nota?: string }) {
  return (
    <div className="estrutura-bloco">
      <div className="estrutura-bloco-topo">
        <h3>{titulo}</h3>
        <Copiar texto={texto} />
      </div>
      <p className="estrutura-texto">{texto}</p>
      {nota ? <p className="fraco estrutura-nota">{nota}</p> : null}
    </div>
  );
}

function Experiencias({ itens, plataforma }: { itens: ExperienciaEstruturada[]; plataforma: Plataforma }) {
  if (itens.length === 0) return null;
  return (
    <div className="caixa medidor-cartao">
      <h2>Experiências</h2>
      {itens.map((e, i) => (
        <div key={i} className="estrutura-bloco">
          <div className="estrutura-bloco-topo">
            <h3>
              {e.cargo}
              {e.empresa ? <span className="fraco"> · {e.empresa}</span> : null}
            </h3>
            <Copiar texto={e.descricao} />
          </div>
          {e.periodo ? (
            <p className="fraco estrutura-nota">
              {plataforma === 'gupy' ? `Período (vai nos campos de data): ${e.periodo}` : e.periodo}
            </p>
          ) : null}
          <p className="estrutura-texto">{e.descricao}</p>
          {e.competencias.length > 0 ? (
            <ul className="etiquetas">
              {e.competencias.map((c) => (
                <li key={c} className="etiqueta">
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Lista({ titulo, itens, rodape }: { titulo: string; itens: string[]; rodape: string }) {
  if (itens.length === 0) return null;
  return (
    <div className="caixa medidor-cartao">
      <h2>{titulo}</h2>
      <ul className="etiquetas">
        {itens.map((c) => (
          <li key={c} className="etiqueta">
            {c}
          </li>
        ))}
      </ul>
      <div className="estrutura-rodape">
        <p className="fraco">{rodape}</p>
        <Copiar texto={itens.join(', ')} />
      </div>
    </div>
  );
}

function ResultadoLinkedin({ r }: { r: EstruturaLinkedin }) {
  return (
    <>
      <div className="caixa medidor-cartao">
        <h2>Topo do perfil</h2>
        {r.headlines.map((h, i) => (
          <Bloco key={i} titulo={`Headline, opção ${i + 1}`} texto={h} />
        ))}
        <Bloco titulo="Sobre" texto={r.sobre} />
      </div>
      <Experiencias itens={r.experiencias} plataforma="linkedin" />
      <Lista
        titulo="Competências"
        itens={r.competencias}
        rodape="Em ordem de prioridade. O LinkedIn aceita até 100, mas é teto, não meta: associe cada uma à experiência em que ela aparece."
      />
      {r.destaques.length > 0 ? (
        <div className="caixa medidor-cartao">
          <h2>Ideias para Destaques</h2>
          <ul className="medidor-lista">
            {r.destaques.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          <p className="fraco medidor-cartao-rodape">
            Destaques não contam na busca do recrutador: servem de prova para quem já abriu o perfil.
          </p>
        </div>
      ) : null}
    </>
  );
}

function ResultadoGupy({ r }: { r: EstruturaGupy }) {
  return (
    <>
      <div className="caixa medidor-cartao alerta">
        <h2>Antes de colar</h2>
        <p className="estrutura-texto">{AVISO_GUPY}</p>
      </div>
      <Experiencias itens={r.experiencias} plataforma="gupy" />
      <Lista
        titulo="Habilidades"
        itens={r.habilidades}
        rodape="Em ordem de prioridade. A Gupy aceita até 30: inclua só as que você consegue sustentar numa entrevista."
      />
      <div className="caixa medidor-cartao">
        <h2>Apresente-se</h2>
        <Bloco
          titulo="Texto"
          texto={r.apresenteSe}
          nota={
            r.apresenteSeGenerico
              ? 'Escrito para o cargo, sem vaga de referência. Personalize para cada vaga: este campo pode mudar por candidatura.'
              : 'Personalizado para a vaga colada. Este campo pode mudar por candidatura.'
          }
        />
      </div>
    </>
  );
}

function Resultado({ resultado, id }: { resultado: Estrutura; id: string | undefined }) {
  const { nome, artigo } = OPCOES[resultado.plataforma];
  return (
    <section className="medidor-resultado" aria-live="polite">
      <h2 className="medidor-manchete">Seu currículo para {artigo} {nome}</h2>

      {resultado.pendencias.length > 0 ? (
        <div className="caixa aviso">
          <strong>Preencha antes de publicar:</strong> {resultado.pendencias.join(' · ')}
        </div>
      ) : null}

      <div className="medidor-detalhes">
        {resultado.plataforma === 'linkedin' ? <ResultadoLinkedin r={resultado} /> : <ResultadoGupy r={resultado} />}

        <div className="caixa medidor-cartao">
          <h2>Checklist de revisão</h2>
          <ul className="medidor-lista">
            {CHECKLIST[resultado.plataforma].map((c) => (
              <li key={c} className="estrutura-check">
                <Check />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {id ? <Feedback id={id} /> : null}
    </section>
  );
}

function Feedback({ id }: { id: string }) {
  const [respondido, setRespondido] = useState(false);

  async function responder(util: boolean) {
    setRespondido(true);
    await registrarFeedback(id, util);
  }

  return (
    <div className="caixa boa medidor-feedback">
      {respondido ? (
        <p>Obrigado. Isso ajuda a decidir se vale continuar investindo no estruturador.</p>
      ) : (
        <>
          <p>Este resultado foi útil?</p>
          <div>
            <button type="button" onClick={() => responder(true)}>
              Sim
            </button>
            <button type="button" className="discreto" onClick={() => responder(false)}>
              Não
            </button>
          </div>
        </>
      )}
    </div>
  );
}
