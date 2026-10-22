-- 0007 — "Só Remoto", limite diário e a fila de coleta agrupada por família
--
-- Três mudanças que vêm da mesma decisão de produto (26/08): o usuário busca
-- qualquer cargo, escolhe se quer só remoto, e o tier gratuito tem teto diário.

-- ---------------------------------------------------------------------------
-- "Só Remoto" mora no perfil, não na URL.
--
-- O CLAUDE.md dizia que "no free tier não há seleção de modelo de trabalho".
-- Isso mudou por decisão do Pedro em 26/08: a opção existe. Ela fica no perfil
-- porque é preferência persistente — quem procura trabalho remoto procura
-- remoto toda semana, não uma vez.
--
-- Consequência que não é óbvia: com `so_remoto`, a CIDADE deixa de filtrar. O
-- feed passa a ser "remoto em todo o Brasil", e a cidade só volta a importar se
-- a pessoa desligar a opção.
-- ---------------------------------------------------------------------------
alter table public.perfis
  add column if not exists so_remoto boolean not null default false;

comment on column public.perfis.so_remoto is
  'true = feed só com vagas remotas do Brasil inteiro; a cidade deixa de filtrar.';

-- ---------------------------------------------------------------------------
-- A fila de coleta precisa agrupar por FAMÍLIA, não por texto.
--
-- Medido no primeiro uso real: o Pedro digitou "Enfermagem", "Enfermeira" e
-- "Enfermeiro" na mesma sessão, e a `demanda_descoberta` mostrou TRÊS linhas
-- com uma pessoa cada. Uma necessidade, três pedidos fracos — e a fila que
-- decide onde gastar crédito da Serper nasceu fragmentada por grafia e por
-- gênero gramatical.
--
-- A chave é calculada no TypeScript (`chaveDeFamilia`), com as mesmas funções
-- que decidem se um cargo bate com uma vaga. Calcular no SQL abriria a porta
-- para as duas regras discordarem, que é o modo de falha que este projeto já
-- conhece.
-- ---------------------------------------------------------------------------
alter table public.buscas
  add column if not exists cargo_familia text;

comment on column public.buscas.cargo_familia is
  'Chave de família do cargo buscado, normalizada em TS. Agrupa enfermeiro/enfermeira num pedido só.';

create index if not exists buscas_familia_idx
  on public.buscas (cargo_familia, cidade_slug)
  where resultados = 0;

drop view if exists public.demanda_descoberta;

create view public.demanda_descoberta as
select
  coalesce(cargo_familia, lower(trim(cargo)))       as familia,
  cidade_slug,
  -- Continua útil ver o que as pessoas realmente escrevem: é o que revela que
  -- "enfermagem" e "enfermeiro" são o mesmo pedido antes de a regra saber.
  array_agg(distinct lower(trim(cargo)))            as termos,
  count(distinct user_id)                           as pessoas,
  count(*)                                          as pedidos,
  min(criado_em)                                    as primeiro_pedido,
  max(criado_em)                                    as ultimo_pedido
from public.buscas
where resultados = 0
group by 1, 2
order by pessoas desc, pedidos desc;

comment on view public.demanda_descoberta is
  'Famílias de cargo x cidade pedidas e não cobertas, por pessoas distintas. Fila de priorização da coleta paga.';

-- ---------------------------------------------------------------------------
-- Fila de coleta paga.
--
-- Separada da view porque a view é leitura e esta tabela é ESTADO: o que já foi
-- atendido, o que falhou, e quanto custou. Sem ela, a mesma família voltaria ao
-- topo da fila para sempre, já que quem foi atendido some da `demanda_descoberta`
-- só quando o feed deixa de vir vazio — e isso pode demorar.
-- ---------------------------------------------------------------------------
create table if not exists public.fila_de_coleta (
  id             bigint      generated always as identity primary key,
  familia        text        not null,
  cidade_slug    text        not null,
  termo          text        not null,
  cidade         text        not null,
  pessoas        integer     not null default 1,
  estado         text        not null default 'pendente'
    check (estado in ('pendente', 'coletando', 'atendida', 'falhou')),
  creditos_gastos integer    not null default 0,
  itens_novos    integer     not null default 0,
  criado_em      timestamptz not null default now(),
  atendido_em    timestamptz,
  detalhe        text,

  unique (familia, cidade_slug)
);

create index if not exists fila_pendente_idx
  on public.fila_de_coleta (pessoas desc, criado_em)
  where estado = 'pendente';

-- Só o servidor e os scripts escrevem, com a chave secreta.
alter table public.fila_de_coleta enable row level security;
