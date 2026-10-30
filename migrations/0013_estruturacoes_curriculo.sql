-- 0013 — Estruturador de currículo para LinkedIn e Gupy: uma linha por geração, SEM o currículo (29/10/2026).
--
-- Mesma decisão do medidor (0012): o currículo é processado em memória e
-- descartado. A tabela é o evento, para medir uso, qual plataforma as pessoas
-- pedem e se o resultado foi útil. Não guarda o texto gerado: ele é o
-- currículo reescrito, e reconstruiria o documento.
--
-- Escrita só pelo servidor, com a chave secreta. RLS ligada e sem policy.

create table if not exists public.estruturacoes_curriculo (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users (id) on delete set null,
  criado_em       timestamptz not null default now(),
  plataforma      text not null check (plataforma in ('linkedin', 'gupy')),
  tipo_entrada    text not null check (tipo_entrada in ('pdf', 'docx', 'texto')),
  cargo           text not null,
  tinha_vaga      boolean not null,
  caracteres      integer not null,
  hash_entrada    text not null,
  -- Contagens do que saiu, não o conteúdo. Null quando a geração falhou.
  experiencias    integer,
  itens           integer,
  pendencias      integer,
  modelo          text,
  duracao_ms      integer,
  erro            text,
  util            boolean,
  feedback_em     timestamptz
);

comment on table public.estruturacoes_curriculo is
  'Evento de estruturação de currículo para LinkedIn/Gupy. Nunca guarda currículo, vaga nem texto gerado.';
comment on column public.estruturacoes_curriculo.itens is
  'Competências (LinkedIn) ou habilidades (Gupy) sugeridas.';

alter table public.estruturacoes_curriculo enable row level security;

create index if not exists estruturacoes_curriculo_user_idx on public.estruturacoes_curriculo (user_id, criado_em desc);
