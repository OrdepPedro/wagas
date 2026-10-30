'use client';

import { useActionState, useId, useState } from 'react';

import { CRITERIOS, PILARES } from '../../../../src/curriculo/rubrica.ts';
import { Check } from '../../check.tsx';
import type { ResultadoDaMedicao, TipoAlerta } from '../../../../src/curriculo/tipos.ts';
import { medir, registrarFeedback, type EstadoDaMedicao } from './acoes.ts';

export function Medidor() {
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [estado, enviar, medindo] = useActionState<EstadoDaMedicao, FormData>(async (anterior, dados) => {
    const proximo = await medir(anterior, dados);
    // O React limpa o input de arquivo junto com o formulário; o nome exibido
    // tem que sumir junto, senão a área diz que há arquivo e o envio é recusado.
    setArquivo(null);
    return proximo;
  }, {});
  const [colar, setColar] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  // Controlados de propósito: o React 19 limpa o formulário depois de cada
  // action, e quem corrige o currículo e mede de novo não deveria redigitar
  // cargo e vaga. O arquivo é o único que volta vazio — o novo envio é outro arquivo.
  const [cargo, setCargo] = useState('');
  const [vaga, setVaga] = useState('');
  const [texto, setTexto] = useState('');
  const mostrarTexto = colar || Boolean(estado.pedirTexto);

  return (
    <>
      <form action={enviar} className="hero-busca medidor-form">
        {mostrarTexto ? (
          <>
            <label htmlFor="ats-texto">Texto do currículo</label>
            <textarea
              id="ats-texto"
              name="texto"
              rows={10}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Cole aqui o currículo inteiro"
            />
            <p className="fraco nota-campo">
              Texto colado não mostra o layout, então o critério de formato fica fora da nota.
            </p>
          </>
        ) : (
          // O input cobre a área inteira, invisível: soltar o arquivo em cima
          // dele é o comportamento nativo do navegador, sem reimplementar o drop.
          <div
            className={`soltar${arrastando ? ' arrastando' : ''}${arquivo ? ' com-arquivo' : ''}`}
            onDragEnter={() => setArrastando(true)}
            onDragLeave={() => setArrastando(false)}
            onDrop={() => setArrastando(false)}
          >
            <input
              id="ats-arquivo"
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

        <label htmlFor="ats-cargo">Cargo que você busca</label>
        <input
          id="ats-cargo"
          name="cargo"
          type="text"
          required
          value={cargo}
          onChange={(e) => setCargo(e.target.value)}
          placeholder="Ex.: Analista de Dados"
        />

        <label htmlFor="ats-vaga">Descrição da vaga (opcional)</label>
        <textarea
          id="ats-vaga"
          name="vaga"
          rows={5}
          value={vaga}
          onChange={(e) => setVaga(e.target.value)}
          placeholder="Cole a vaga para medir a aderência a ela. Sem vaga, comparamos com o que o cargo costuma pedir."
        />

        {estado.erro ? <p className="erro">{estado.erro}</p> : null}

        <button type="submit" disabled={medindo}>
          {medindo ? 'Medindo… pode levar até 30 segundos' : 'Medir currículo'}
        </button>
      </form>

      <ul className="garantias" aria-label="O que você precisa saber">
        <li>
          <Check />
          Lido em memória e descartado
        </li>
        <li>
          <Check />
          Sem cadastro
        </li>
        <li>
          <Check />
          Grátis
        </li>
      </ul>
      <p className="fraco medidor-ressalva">
        Guardamos só a nota e os pontos por critério, nunca o texto. A nota é um diagnóstico do wagas, não a da
        Gupy, do LinkedIn ou de qualquer empresa: nenhum ATS publica a nota que dá.
      </p>

      {estado.resultado ? <Resultado resultado={estado.resultado} id={estado.id} /> : null}
    </>
  );
}

const ROTULO_ALERTA: Record<TipoAlerta, string> = {
  eliminatorio: 'Pode eliminar',
  extracao: 'Leitura do arquivo',
  lacuna: 'Lacuna real',
  privacidade: 'Privacidade',
};

const MANCHETE: Record<ResultadoDaMedicao['faixa'], string> = {
  'Muito bom': 'Seu currículo está bem preparado',
  'Bom, com ajustes pontuais': 'Bom, mas ainda dá para melhorar',
  'Lacunas relevantes': 'Há lacunas que custam pontos',
  'Recomenda-se reestruturação': 'Vale reestruturar o currículo',
};

/** Mesmos cortes das faixas da rubrica: 70 abre "Bom", 50 abre "Lacunas". */
function nivel(pct: number): 'bom' | 'medio' | 'ruim' {
  if (pct >= 70) return 'bom';
  if (pct >= 50) return 'medio';
  return 'ruim';
}

function Anel({ nota }: { nota: number }) {
  const raio = 52;
  const volta = 2 * Math.PI * raio;
  return (
    <div className="medidor-anel" role="img" aria-label={`Nota ${nota} de 100`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={raio} className="medidor-anel-fundo" />
        <circle
          cx="60"
          cy="60"
          r={raio}
          className={`medidor-anel-valor nivel-${nivel(nota)}`}
          strokeDasharray={volta}
          strokeDashoffset={volta * (1 - nota / 100)}
        />
      </svg>
      <p aria-hidden="true">
        <strong>{nota}</strong>
        <span>/100</span>
      </p>
    </div>
  );
}

/** Abre no hover e no foco; no toque, o clique alterna — celular não tem hover. */
function Dica({ texto }: { texto: string }) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  return (
    <span className={`dica${aberta ? ' aberta' : ''}`}>
      <button
        type="button"
        aria-label="O que é este critério"
        aria-describedby={id}
        aria-expanded={aberta}
        onClick={() => setAberta(!aberta)}
        onBlur={() => setAberta(false)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7.2V11.5M8 4.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <span role="tooltip" id={id} className="dica-texto">
        {texto}
      </span>
    </span>
  );
}

const TRACO_ICONE: Record<'requisitos' | 'alertas' | 'melhorias', string> = {
  requisitos: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  alertas: 'M12 9v4m0 4v.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  melhorias: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
};

function IconeCartao({ tipo }: { tipo: keyof typeof TRACO_ICONE }) {
  return (
    <span className="medidor-cartao-icone" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18">
        <path
          d={TRACO_ICONE[tipo]}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Resultado({ resultado, id }: { resultado: ResultadoDaMedicao; id: string | undefined }) {
  const { nota, faixa, estimada, criterios, requisitos, alertas, melhorias } = resultado;
  const grupos = [
    { titulo: 'Demonstrados', icone: '✅', itens: requisitos.filter((r) => r.status === 'demonstrado') },
    { titulo: 'Citados sem contexto ou com outra grafia', icone: '🟡', itens: requisitos.filter((r) => r.status === 'sem_contexto') },
    { titulo: 'Ausentes (inclua só se você tiver a experiência)', icone: '❌', itens: requisitos.filter((r) => r.status === 'ausente') },
  ];

  return (
    <section className="medidor-resultado" aria-live="polite">
      <h2 className="medidor-manchete">{MANCHETE[faixa]}</h2>

      <div className="caixa medidor-placar">
        <div className="medidor-nota">
          <Anel nota={nota} />
          <p className="medidor-faixa">
            Sua nota: <strong className={`nivel-${nivel(nota)}`}>{faixa}</strong>
          </p>
          <p className="fraco">
            {estimada ? 'Estimada contra o que o cargo costuma pedir, sem vaga de referência. ' : ''}
            Diagnóstico do wagas, não a nota de nenhuma plataforma ou empresa.
          </p>
        </div>

        {PILARES.map((pilar) => (
          <div key={pilar} className="medidor-pilar">
            <h3>{pilar}</h3>
            {criterios
              .filter((c) => CRITERIOS[c.id].pilar === pilar)
              .map((c) => {
                const pct = Math.round((100 * c.pontos) / c.maximo);
                return (
                  <div key={c.id} className="medidor-criterio">
                    <div className="medidor-criterio-topo">
                      <span className="medidor-criterio-nome">
                        {c.nome}
                        <Dica texto={CRITERIOS[c.id].descricao} />
                      </span>
                      {c.avaliado ? (
                        <strong className={`nivel-${nivel(pct)}`} title={`${c.pontos} de ${c.maximo} pontos`}>
                          {pct}%
                        </strong>
                      ) : (
                        <span className="fraco">não avaliado</span>
                      )}
                    </div>
                    {c.avaliado ? (
                      <div className="medidor-barra" aria-hidden="true">
                        <span className={`nivel-${nivel(pct)}`} style={{ width: `${pct}%` }} />
                      </div>
                    ) : null}
                    {c.observacao ? <p className="medidor-observacao">{c.observacao}</p> : null}
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      <div className="medidor-detalhes">
        {requisitos.length > 0 ? (
          <div className="caixa medidor-cartao">
            <h2>
              <IconeCartao tipo="requisitos" />
              {estimada ? 'O que o cargo costuma pedir' : 'Requisitos da vaga'}
            </h2>
            {grupos
              .filter((g) => g.itens.length > 0)
              .map((g) => (
                <div key={g.titulo} className="medidor-grupo">
                  <h3>
                    {g.icone} {g.titulo}
                  </h3>
                  <ul className="etiquetas">
                    {g.itens.map((r) => (
                      <li key={r.termo} className={`etiqueta${r.essencial ? ' destaque' : ''}`}>
                        {r.grafiaNoCurriculo ? `${r.grafiaNoCurriculo} → ${r.termo}` : r.termo}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            <p className="fraco medidor-cartao-rodape">
              Em destaque, os essenciais. São eles que contam no critério de requisitos.
            </p>
          </div>
        ) : null}

        {alertas.length > 0 ? (
          <div className="caixa medidor-cartao alerta">
            <h2>
              <IconeCartao tipo="alertas" />
              Alertas fora da nota
            </h2>
            <ul className="medidor-lista">
              {alertas.map((a, i) => (
                <li key={i}>
                  <strong>{ROTULO_ALERTA[a.tipo]}</strong>
                  {a.texto}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {melhorias.length > 0 ? (
          <div className="caixa medidor-cartao">
            <h2>
              <IconeCartao tipo="melhorias" />
              O que mais aumenta a nota
            </h2>
            <ol className="medidor-lista numerada">
              {melhorias.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ol>
          </div>
        ) : null}
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
        <p>Obrigado. Isso ajuda a decidir se vale continuar investindo no medidor.</p>
      ) : (
        <>
          <p>Esta avaliação foi útil?</p>
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
