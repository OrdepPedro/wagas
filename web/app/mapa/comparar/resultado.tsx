import { placar, type RequisitoComparado } from '../../../../src/mapa/comparar.ts';

/** O resultado da comparação: o placar e as três listas. Só desenha. */

function Lista({
  titulo,
  itens,
  vazio,
  dica,
}: {
  titulo: string;
  itens: RequisitoComparado[];
  vazio: string;
  dica?: string;
}) {
  return (
    <section className="comparacao-grupo">
      <h2>
        {titulo} <span className="fraco">({itens.length})</span>
      </h2>
      {dica && itens.length > 0 ? <p className="fraco">{dica}</p> : null}
      {itens.length === 0 ? (
        <p className="fraco">{vazio}</p>
      ) : (
        <ul>
          {itens.map((r) => (
            <li key={r.termo}>
              <strong>{r.termo}</strong>
              {r.essencial ? <span className="etiqueta">obrigatório</span> : <span className="etiqueta">diferencial</span>}
              {r.grafiaNoCurriculo ? <span className="fraco"> · no seu currículo: “{r.grafiaNoCurriculo}”</span> : null}
              {r.trecho ? <q className="comparacao-trecho">{r.trecho}</q> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Resultado({ jobId, requisitos }: { jobId: number; requisitos: RequisitoComparado[] }) {
  const p = placar(requisitos);
  const tem = requisitos.filter((r) => r.status === 'demonstrado');
  const semContexto = requisitos.filter((r) => r.status === 'sem_contexto');
  // Obrigatórios primeiro: é o que elimina.
  const falta = requisitos.filter((r) => r.status === 'ausente').sort((a, b) => Number(b.essencial) - Number(a.essencial));

  return (
    <>
      <div className="comparacao-placar">
        <strong>
          {p.demonstrados} de {p.total}
        </strong>
        <span>
          {p.essenciais ? 'requisitos obrigatórios' : 'requisitos'} com prova no seu currículo
          {p.semContexto > 0 ? ` · ${p.semContexto} ${p.semContexto === 1 ? 'aparece' : 'aparecem'} sem contexto` : ''}
        </span>
      </div>

      <Lista titulo="Você tem" itens={tem} vazio="Nenhum requisito com prova no currículo." />
      <Lista
        titulo="Aparecem sem contexto"
        itens={semContexto}
        vazio="Nenhum."
        dica="Estão no currículo, mas só numa lista ou com outra grafia. Dizer onde você usou cada um ajuda o recrutador a achar."
      />
      <Lista titulo="Falta" itens={falta} vazio="Nada que a vaga pede ficou de fora." />

      <p className="fraco comparacao-nota">
        Comparação feita por IA sobre o texto do seu currículo. Cada “você tem” vem com o trecho que o prova, conferido
        no seu currículo; o que não pôde ser conferido não conta. Confira antes de contar com ela. Trocou o currículo em{' '}
        <a href={`/curriculo?comparar=${jobId}`}>Meu currículo</a>? A vaga pede comparação nova.
      </p>
    </>
  );
}
