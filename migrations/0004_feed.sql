-- 0004 — as colunas que o feed filtra (Passo 4)
--
-- O feed do produto é uma consulta com quatro predicados: cargo, cidade, modelo
-- e janela de 7 dias. Ao chegar no Passo 4, NENHUM dos quatro existia como
-- coluna consultável — medido sobre as 197 linhas gravadas em 24/08:
--
--   cargo    `cargo_normalizado` tem 15+ valores distintos para 6 cargos
--            (`senior product manager`, `growth product manager`,
--            `product manager jr`). Igualdade devolve quase nada, e `ilike`
--            não sabe que Product Owner é da família de Product Manager.
--   cidade   `localizacao` é texto livre do modelo: 25 grafias de São Paulo,
--            42 nulls, e "Green Bay, Wisconsin" no meio.
--   modelo   null em 114 de 197 (58%).
--   janela   `data_publicacao` null em 197 de 197.
--
-- A regra do CLAUDE.md é que o filtro do usuário roda no Postgres sobre o
-- cache. Para isso valer, a decisão precisa estar gravada como dado, não
-- recalculada em memória a cada request.

-- ---------------------------------------------------------------------------
-- Família de cargo, em forma de array.
--
-- É a tradução literal das duas condições de `cargoBateNoTitulo`:
--   1. todo token de domínio do cargo buscado aparece no título -> `@>`
--   2. ao menos uma função da mesma classe                      -> `&&`
--
-- `familia_tokens` guarda plural e singular de cada token, como o casamento em
-- TypeScript faz; a busca consulta pela forma singular.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists familia_tokens  text[] not null default '{}',
  add column if not exists familia_classes text[] not null default '{}';

comment on column public.jobs.familia_tokens is
  'Tokens do cargo (domínio + função + senioridade, plural e singular). Filtro: familia_tokens @> ARRAY[...].';
comment on column public.jobs.familia_classes is
  'Classes de função do cargo. Vazio = título sem função reconhecida, e aí não restringe.';

create index if not exists jobs_familia_tokens_idx  on public.jobs using gin (familia_tokens);
create index if not exists jobs_familia_classes_idx on public.jobs using gin (familia_classes);

-- ---------------------------------------------------------------------------
-- Local, decomposto.
--
-- `pais_br` tem TRÊS estados de propósito. Colapsar null em false esconderia
-- vaga brasileira cuja localização o anúncio não qualificou; colapsar em true
-- deixaria no feed a vaga remota da França que hoje está no banco.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists cidade_slug text,
  add column if not exists uf          text,
  add column if not exists pais_br     boolean;

comment on column public.jobs.cidade_slug is
  'Cidade em forma de slug (sao-paulo). Chave de igualdade do filtro de cidade.';
comment on column public.jobs.pais_br is
  'true = Brasil confirmado, false = fora confirmado, null = não deu para saber pelo texto.';

create index if not exists jobs_cidade_idx on public.jobs (cidade_slug, uf);

-- ---------------------------------------------------------------------------
-- Frescor.
--
-- `data_publicacao` é o campo certo e continua sendo o alvo. Enquanto ele for
-- null na maioria das linhas, o feed precisa de ALGUMA coluna indexável para a
-- janela de 7 dias, e a única disponível é a data de coleta.
--
-- A coluna gerada existe para deixar essa concessão explícita no schema em vez
-- de escondida num `coalesce` espalhado pelas consultas. Ela NÃO conserta o
-- problema: com `qdr:w`, um item coletado ontem já tinha até 7 dias, então
-- `data_referencia >= now() - 7 dias` entrega uma janela real de até 14 dias.
-- Só a data de publicação de verdade fecha isso.
--
-- `data_publicacao_origem` vem junto porque data sem procedência não é
-- verificável: o feed precisa poder dizer "publicada em 21/08 (Gupy)" e
-- "coletada em 24/08 (data desconhecida)" de formas diferentes.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists data_publicacao_origem text not null default 'desconhecida';

do $$
begin
  alter table public.jobs
    add constraint jobs_origem_data_valida
    check (data_publicacao_origem in ('gupy_snippet', 'metatag', 'desconhecida'));
exception
  when duplicate_object then null;
end
$$;

alter table public.jobs
  add column if not exists data_referencia timestamptz
    generated always as (coalesce(data_publicacao, data_coleta)) stored;

comment on column public.jobs.data_referencia is
  'Frescor consultável. É data_publicacao quando existe; senão data_coleta, que é PROXY e alarga a janela.';

create index if not exists jobs_janela_idx
  on public.jobs (ativo, data_referencia desc);

-- ---------------------------------------------------------------------------
-- Portão de local: o veredito do classificador, gravado.
--
-- As 197 linhas de 24/08 foram classificadas ANTES do portão existir (rodada às
-- 14:33, portão commitado às 17:23), e por isso o banco tem vaga híbrida em
-- Green Bay/Wisconsin e remota na França e na Venezuela. Sem esta coluna não dá
-- para distinguir "o portão aprovou" de "o portão não rodou".
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists local_avaliado boolean not null default false;

comment on column public.jobs.local_avaliado is
  'true = o portão de local do classificador julgou esta vaga. false = linha anterior ao portão.';
