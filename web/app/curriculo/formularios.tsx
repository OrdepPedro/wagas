'use client';

import { useActionState, useState } from 'react';
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
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [estado, acao] = useActionState<EstadoDoCurriculo, FormData>(async (anterior, dados) => {
    const proximo = await salvarCurriculoAcao(anterior, dados);
    // O React limpa o input de arquivo junto com o formulário; o nome exibido
    // some junto, senão a linha diz que há arquivo e não há.
    setArquivo(null);
    return proximo;
  }, VAZIO);

  return (
    <form action={acao}>
      {voltar ? <input type="hidden" name="voltar" value={voltar} /> : null}
      <div className="campos">
        <div>
          <label htmlFor="pdf">Enviar PDF ou DOCX</label>
          <div
            className={`arquivo-linha${arrastando ? ' arrastando' : ''}${arquivo ? ' com-arquivo' : ''}`}
            onDragEnter={() => setArrastando(true)}
            onDragLeave={() => setArrastando(false)}
            onDrop={() => setArrastando(false)}
          >
            <input
              id="pdf"
              name="pdf"
              type="file"
              accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
              onChange={(e) => setArquivo(e.target.files?.[0]?.name ?? null)}
            />
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="arquivo-linha-texto">{arquivo ?? 'Arraste o arquivo aqui'}</span>
            <span className="arquivo-linha-acao">{arquivo ? 'trocar' : 'ou escolha'}</span>
          </div>
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
