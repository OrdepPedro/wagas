-- 0012 — Medidor de currículo: uma linha por medição, SEM o currículo (28/10/2026).
--
-- Decisões do Pedro em 28/10: a medição é efêmera (o currículo é processado em
-- memória e descartado) e a validação da ideia sai de evento + feedback. Esta
-- tabela é o evento. Ela guarda o que permite medir uso e qualidade, e nada que
-- permita reconstruir o documento:
--
--   - a nota e os pontos por critério, para ver onde os currículos mais falham;
--   - `hash_entrada`, sha-256 de currículo + cargo + vaga. Não é reversível e
--     serve para duas contas que de outro jeito exigiriam guardar o texto: a
--     mesma entrada medida duas vezes deu a mesma nota? (achados 11 e 23, agora
--     no medidor) e a pessoa reenviou um currículo DIFERENTE depois de ler as
--     melhorias? (a nota subiu?);
--   - `util`, o "isso foi útil?" do fim da tela.
--
-- O cargo-alvo fica: é o que a pessoa digitou, como em `buscas`, e não é dado
-- do currículo.
--
-- Escrita só pelo servidor, com a chave secreta. RLS ligada e sem policy: a
-- chave pública não lê nem grava nada aqui.

create table if not exists public.medicoes_curriculo (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users (id) on delete set null,
  criado_em       timestamptz not null default now(),
  tipo_entrada    text not null check (tipo_entrada in ('pdf', 'docx', 'texto')),
  cargo           text not null,
  tinha_vaga      boolean not null,
  paginas         integer,
  caracteres      integer not null,
  sinais          jsonb not null,
  hash_entrada    text not null,
  -- Null quando a medição falhou (arquivo ilegível, LLM fora).
  nota            integer check (nota between 0 and 100),
  criterios       jsonb,
  requisitos_total      integer,
  requisitos_demonstrados integer,
  alertas_tipos   text[],
  modelo          text,
  duracao_ms      integer,
  erro            text,
  util            boolean,
  feedback_em     timestamptz
);

comment on table public.medicoes_curriculo is
  'Evento de medição de currículo. Nunca guarda o texto do currículo nem da vaga (medição efêmera, decisão de 28/10).';
comment on column public.medicoes_curriculo.hash_entrada is
  'sha-256 de currículo + cargo + vaga. Mede reprodutibilidade e reenvio sem guardar o documento.';

alter table public.medicoes_curriculo enable row level security;

-- Teto diário por pessoa: a contagem filtra por user_id e data.
create index if not exists medicoes_curriculo_user_idx on public.medicoes_curriculo (user_id, criado_em desc);
create index if not exists medicoes_curriculo_hash_idx on public.medicoes_curriculo (hash_entrada);

-- A retenção do visitante (0010) já anonimiza por `on delete set null`: quando a
-- conta anônima é apagada, a medição fica sem dono.
