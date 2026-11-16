import type { CurriculoAdaptado } from '../../../../src/curriculo/adaptar.ts';

/** O currículo como vai sair no PDF. Sem estado: serve à página e ao editor (cliente). */
export function Previa({ cv }: { cv: CurriculoAdaptado }) {
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
