-- 0017 — pedido de coleta do InfoJobs disparado pela busca
--
-- Par novo só recebia o InfoJobs na coleta diária do dia seguinte. A busca
-- agora PEDE a coleta: grava uma linha aqui e dispara o workflow
-- `outra-fonte.yml`, que coleta só aquele par. O request do usuário nunca abre
-- página do InfoJobs (restrição 3: portal só na coleta).
--
-- Uma linha por par, reaproveitada a cada pedido: a tela só precisa do último
-- estado, e o histórico de demanda já mora em `buscas`.

create table if not exists public.pedidos_outra_fonte (
  cargo_chave     text        not null,
  cidade_slug     text        not null,
  -- O que a pessoa digitou: é o que o coletor passa ao InfoJobs.
  cargo           text        not null,
  cidade          text        not null,
  status          text        not null default 'pendente',
  pedido_em       timestamptz not null default now(),
  iniciado_em     timestamptz,
  concluido_em    timestamptz,
  vagas_gravadas  integer,
  motivo          text,

  primary key (cargo_chave, cidade_slug),
  constraint pedidos_outra_fonte_status_valido
    check (status in ('pendente', 'rodando', 'pronto', 'falhou', 'adiado', 'sem_uf'))
);

comment on table public.pedidos_outra_fonte is
  'Coleta do InfoJobs pedida por uma busca. pendente -> rodando -> pronto | falhou | adiado (coleta diária rodando) | sem_uf.';

create index if not exists pedidos_outra_fonte_pendentes_idx
  on public.pedidos_outra_fonte (pedido_em)
  where status = 'pendente';

-- Só o servidor lê e escreve, com a chave secreta.
alter table public.pedidos_outra_fonte enable row level security;
