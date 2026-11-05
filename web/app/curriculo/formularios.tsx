'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { adaptarAcao, salvarCurriculoAcao, type EstadoDoCurriculo } from './actions.ts';

const VAZIO: EstadoDoCurriculo = {};

function Enviar({ children, pendente }: { children: string; pendente: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? pendente : children}
    </button>
  );
}

export function FormularioDeCurriculo({ texto, voltar }: { texto: string; voltar: string | null }) {
  const [estado, acao] = useActionState(salvarCurriculoAcao, VAZIO);

  return (
    <form action={acao}>
      {voltar ? <input type="hidden" name="voltar" value={voltar} /> : null}
      <div className="campos">
        <div>
          <label htmlFor="pdf">Enviar PDF ou DOCX</label>
          <input id="pdf" name="pdf" type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" className="arquivo" />
          <small className="fraco">Se escolher um arquivo, ele substitui o texto da caixa abaixo.</small>
        </div>
        <div>
          <label htmlFor="texto">ou colar o texto</label>
          <textarea
            id="texto"
            name="texto"
            rows={14}
            defaultValue={texto}
            placeholder="Cole aqui o seu currículo inteiro: experiências, formação, habilidades, contato."
          />
        </div>
      </div>
      <label className="opcao">
        <input type="checkbox" name="consentimento" required />
        <span>
          Concordo que o wagas guarde o texto do meu currículo para adaptá-lo às vagas que eu escolher.
          <small>
            Ele só sai daqui no momento de uma adaptação, para o Groq (o serviço de IA), que por padrão não
            guarda o conteúdo. Você pode apagar o currículo e as adaptações a qualquer momento nesta página.
          </small>
        </span>
      </label>
      {estado.erro ? <p className="erro">{estado.erro}</p> : null}
      <Enviar pendente="Lendo…">Salvar currículo</Enviar>
    </form>
  );
}

export function BotaoDeAdaptar({ jobId, rotulo }: { jobId: number; rotulo: string }) {
  const [estado, acao] = useActionState(adaptarAcao, VAZIO);
  return (
    <form action={acao}>
      <input type="hidden" name="jobId" value={jobId} />
      {estado.erro ? <p className="erro">{estado.erro}</p> : null}
      {/* Leva de 10 a 30 segundos; dizer isso evita o clique duplo. */}
      <Enviar pendente="Adaptando… leva uns 20 segundos">{rotulo}</Enviar>
    </form>
  );
}
