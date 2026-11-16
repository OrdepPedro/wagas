'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { CurriculoAdaptado, Experiencia, Formacao } from '../../../../src/curriculo/adaptar.ts';
import { salvarEdicaoAcao, type EstadoDaEdicao } from '../../curriculo/actions.ts';
import { Previa } from './previa.tsx';

// ---------------------------------------------------------------------------
// Edição manual: a prévia vira formulário, a pessoa escreve o que quiser e
// salva. O salvo é uma versão nova; o PDF continua exigindo a confirmação.
// ---------------------------------------------------------------------------

type Rascunho = Omit<CurriculoAdaptado, 'mudancas' | 'lacunas'>;

/** Listas são editadas como uma linha por item: é o jeito que qualquer pessoa sabe usar. */
const linhas = (texto: string): string[] =>
  texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function rascunhoDe(cv: CurriculoAdaptado): Rascunho {
  const { mudancas: _m, lacunas: _l, ...resto } = cv;
  return structuredClone(resto);
}

function Campo({
  rotulo,
  valor,
  onChange,
  longo,
  dica,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  longo?: boolean;
  dica?: string;
}) {
  return (
    <label className="editor-campo">
      <span>
        {rotulo}
        {dica ? <small className="fraco"> {dica}</small> : null}
      </span>
      {longo ? (
        <textarea rows={Math.min(Math.max(valor.split('\n').length + 1, 3), 12)} value={valor} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" value={valor} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/** Lista editada como texto, uma linha por item. Guarda o texto cru para a quebra de linha não sumir enquanto digita. */
function CampoDeLista({ rotulo, itens, onChange }: { rotulo: string; itens: string[]; onChange: (v: string[]) => void }) {
  const [texto, setTexto] = useState(itens.join('\n'));
  return (
    <Campo
      rotulo={rotulo}
      dica="(um por linha)"
      longo
      valor={texto}
      onChange={(v) => {
        setTexto(v);
        onChange(linhas(v));
      }}
    />
  );
}

function Salvar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Salvando…' : 'Salvar edição'}
    </button>
  );
}

function Editor({ jobId, cv, aoSair }: { jobId: number; cv: CurriculoAdaptado; aoSair: () => void }) {
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(cv));
  const [estado, acao] = useActionState<EstadoDaEdicao, FormData>(salvarEdicaoAcao, {});
  const salvoAntes = useRef(estado.salvo);

  useEffect(() => {
    if (estado.salvo && estado.salvo !== salvoAntes.current) aoSair();
  }, [estado.salvo, aoSair]);

  const mudar = <K extends keyof Rascunho>(campo: K, valor: Rascunho[K]) => setR((a) => ({ ...a, [campo]: valor }));
  const mudarExp = (i: number, parcial: Partial<Experiencia>) =>
    mudar('experiencias', r.experiencias.map((e, j) => (j === i ? { ...e, ...parcial } : e)));
  const mudarForm = (i: number, parcial: Partial<Formacao>) =>
    mudar('formacao', r.formacao.map((f, j) => (j === i ? { ...f, ...parcial } : f)));

  return (
    <form action={acao} className="cv editor">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="curriculo" value={JSON.stringify(r)} />

      <Campo rotulo="Nome" valor={r.nome} onChange={(v) => mudar('nome', v)} />
      <Campo rotulo="Título" valor={r.titulo} onChange={(v) => mudar('titulo', v)} />
      <CampoDeLista rotulo="Contato" itens={r.contato} onChange={(v) => mudar('contato', v)} />
      <Campo rotulo="Resumo" longo valor={r.resumo} onChange={(v) => mudar('resumo', v)} />

      <h3>Experiência</h3>
      {r.experiencias.map((e, i) => (
        <fieldset key={i} className="editor-bloco">
          <div className="editor-linha">
            <Campo rotulo="Cargo" valor={e.cargo} onChange={(v) => mudarExp(i, { cargo: v })} />
            <Campo rotulo="Empresa" valor={e.empresa} onChange={(v) => mudarExp(i, { empresa: v })} />
            <Campo rotulo="Período" valor={e.periodo} onChange={(v) => mudarExp(i, { periodo: v })} />
          </div>
          <CampoDeLista rotulo="O que você fez" itens={e.itens} onChange={(v) => mudarExp(i, { itens: v })} />
          <button
            type="button"
            className="link-remover"
            onClick={() => mudar('experiencias', r.experiencias.filter((_, j) => j !== i))}
          >
            Remover esta experiência
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="botao-secundario"
        onClick={() => mudar('experiencias', [...r.experiencias, { cargo: '', empresa: '', periodo: '', itens: [] }])}
      >
        + Experiência
      </button>

      <h3>Formação</h3>
      {r.formacao.map((f, i) => (
        <fieldset key={i} className="editor-bloco">
          <div className="editor-linha">
            <Campo rotulo="Curso" valor={f.curso} onChange={(v) => mudarForm(i, { curso: v })} />
            <Campo rotulo="Instituição" valor={f.instituicao} onChange={(v) => mudarForm(i, { instituicao: v })} />
            <Campo rotulo="Período" valor={f.periodo} onChange={(v) => mudarForm(i, { periodo: v })} />
          </div>
          <button type="button" className="link-remover" onClick={() => mudar('formacao', r.formacao.filter((_, j) => j !== i))}>
            Remover esta formação
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="botao-secundario"
        onClick={() => mudar('formacao', [...r.formacao, { curso: '', instituicao: '', periodo: '' }])}
      >
        + Formação
      </button>

      <h3>Outros</h3>
      <CampoDeLista rotulo="Habilidades" itens={r.habilidades} onChange={(v) => mudar('habilidades', v)} />
      <CampoDeLista rotulo="Certificações" itens={r.certificacoes} onChange={(v) => mudar('certificacoes', v)} />
      <CampoDeLista rotulo="Idiomas" itens={r.idiomas} onChange={(v) => mudar('idiomas', v)} />

      {estado.erro ? <p className="erro">{estado.erro}</p> : null}
      <div className="acoes-cv editor-acoes">
        <Salvar />
        <button type="button" className="botao-secundario" onClick={aoSair}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** A prévia, com o botão que troca para o editor. */
export function CurriculoEditavel({ jobId, cv }: { jobId: number; cv: CurriculoAdaptado }) {
  const [editando, setEditando] = useState(false);
  if (editando) return <Editor jobId={jobId} cv={cv} aoSair={() => setEditando(false)} />;
  return (
    <div className="cv-editavel">
      <div className="cv-editavel-topo">
        <button type="button" className="botao-secundario" onClick={() => setEditando(true)}>
          Editar à mão
        </button>
      </div>
      <Previa cv={cv} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat flutuante: acompanha a página inteira, para a pessoa pedir ajuste
// enquanto lê qualquer parte do currículo.
// ---------------------------------------------------------------------------

export function ChatFlutuante({
  mensagens,
  conversa,
  rodape,
}: {
  mensagens: number;
  conversa: ReactNode;
  rodape: ReactNode;
}) {
  const [aberto, setAberto] = useState(true);
  const rolagem = useRef<HTMLDivElement>(null);

  // No celular o box cobriria metade do currículo: começa minimizado.
  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) setAberto(false);
  }, []);

  // Mensagem nova (a página recarregou com a resposta da IA): desce até ela.
  useEffect(() => {
    const el = rolagem.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens, aberto]);

  // Minimizar só esconde: o formulário continua montado, e um pedido em
  // andamento não se perde.
  return (
    <>
      {aberto ? null : (
        <button type="button" className="chat-flutuante-botao" onClick={() => setAberto(true)} aria-expanded={false}>
          Ajustar com a IA{mensagens > 0 ? ` · ${mensagens}` : ''}
        </button>
      )}
      <aside className="chat-flutuante" aria-label="Ajustar com a IA" hidden={!aberto}>
      <header>
        <strong>Ajustar com a IA</strong>
        <button type="button" onClick={() => setAberto(false)} aria-label="Minimizar" aria-expanded>
          –
        </button>
      </header>
      <div className="chat-flutuante-corpo" ref={rolagem}>
        {conversa}
      </div>
      <div className="chat-flutuante-rodape">{rodape}</div>
      </aside>
    </>
  );
}
