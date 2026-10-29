'use client';

import { useActionState, useState } from 'react';

import { CRITERIOS, PILARES } from '../../../../src/curriculo/rubrica.ts';
import type { ResultadoDaMedicao, TipoAlerta } from '../../../../src/curriculo/tipos.ts';
import { medir, registrarFeedback, type EstadoDaMedicao } from './acoes.ts';

export function Medidor() {
  const [estado, enviar, medindo] = useActionState<EstadoDaMedicao, FormData>(medir, {});
  const [colar, setColar] = useState(false);
  // Controlados de propósito: o React 19 limpa o formulário depois de cada
  // action, e quem corrige o currículo e mede de novo não deveria redigitar
  // cargo e vaga. O arquivo é o único que volta vazio — o novo envio é outro arquivo.
  const [cargo, setCargo] = useState('');
  const [vaga, setVaga] = useState('');
  const [texto, setTexto] = useState('');
  const mostrarTexto = colar || Boolean(estado.pedirTexto);

  return (
    <>
      <form action={enviar} className="caixa medidor-form">
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
          <>
            <label htmlFor="ats-arquivo">Currículo (PDF ou DOCX, até 5 MB)</label>
            <input
              id="ats-arquivo"
              name="arquivo"
              type="file"
              required
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            />
          </>
        )}
        <button type="button" className="discreto alternar-entrada" onClick={() => setColar(!mostrarTexto)}>
          {mostrarTexto ? 'Enviar arquivo em vez de colar' : 'Prefiro colar o texto'}
        </button>

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
        <p className="fraco nota-campo">
          O currículo é lido em memória e descartado. Guardamos só a nota e os pontos por critério, sem o texto.
        </p>
      </form>

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

function Resultado({ resultado, id }: { resultado: ResultadoDaMedicao; id: string | undefined }) {
  const { nota, faixa, estimada, criterios, requisitos, alertas, melhorias } = resultado;
  const grupos = [
    { titulo: 'Demonstrados', icone: '✅', itens: requisitos.filter((r) => r.status === 'demonstrado') },
    { titulo: 'Citados sem contexto ou com outra grafia', icone: '🟡', itens: requisitos.filter((r) => r.status === 'sem_contexto') },
    { titulo: 'Ausentes (inclua só se você tiver a experiência)', icone: '❌', itens: requisitos.filter((r) => r.status === 'ausente') },
  ];

  return (
    <section className="medidor-resultado" aria-live="polite">
      <div className="caixa medidor-nota">
        <p className="medidor-numero">
          {nota}
          <span>/100</span>
        </p>
        <div>
          <p className="medidor-faixa">{faixa}</p>
          <p className="fraco">
            {estimada ? 'Estimada, sem vaga de referência. ' : ''}
            Diagnóstico de boas práticas e aderência do wagas. Não é a nota de nenhuma plataforma ou empresa.
          </p>
        </div>
      </div>

      <div className="caixa">
        <h2>Por critério</h2>
        {PILARES.map((pilar) => (
          <div key={pilar} className="medidor-pilar">
            <h3>{pilar}</h3>
            {criterios
              .filter((c) => CRITERIOS[c.id].pilar === pilar)
              .map((c) => (
                <div key={c.id} className="medidor-criterio">
                  <div className="medidor-criterio-topo">
                    <span>{c.nome}</span>
                    <strong>{c.avaliado ? `${c.pontos}/${c.maximo}` : 'não avaliado'}</strong>
                  </div>
                  {c.avaliado ? (
                    <div className="medidor-barra" aria-hidden="true">
                      <span style={{ width: `${(100 * c.pontos) / c.maximo}%` }} />
                    </div>
                  ) : null}
                  {c.observacao ? <p className="fraco">{c.observacao}</p> : null}
                </div>
              ))}
          </div>
        ))}
      </div>

      {requisitos.length > 0 ? (
        <div className="caixa">
          <h2>{estimada ? 'O que o cargo costuma pedir' : 'Requisitos da vaga'}</h2>
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
          <p className="fraco nota-campo">Em destaque, os essenciais. São eles que contam no critério de requisitos.</p>
        </div>
      ) : null}

      {alertas.length > 0 ? (
        <div className="caixa aviso">
          <h2>Alertas fora da nota</h2>
          <ul className="medidor-lista">
            {alertas.map((a, i) => (
              <li key={i}>
                <strong>{ROTULO_ALERTA[a.tipo]}:</strong> {a.texto}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {melhorias.length > 0 ? (
        <div className="caixa">
          <h2>O que mais aumenta a nota</h2>
          <ol className="medidor-lista">
            {melhorias.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ol>
        </div>
      ) : null}

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
