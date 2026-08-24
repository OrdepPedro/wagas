# wagas — coletor (Passo 2)

Coleta vagas dos últimos 7 dias em três blocos — LinkedIn Jobs, posts do LinkedIn e Gupy —, normaliza, deduplica e grava em `raw_results`. **Não classifica nada**; isso é o Passo 3.

Zero dependência de runtime. Node 24 executa TypeScript direto (type stripping), então não há build, não há `npm ci` no CI e os testes rodam sem instalar nada.

> **A Google Programmable Search morreu.** Fechada a novos projetos em 2025, desligada em 01/01/2027. A fonte de produção agora é a **Serper.dev**. Ver o CLAUDE.md para o histórico e as alternativas avaliadas.

## Rodar

```bash
npm test
```

Comparar a fonte atual com o que o Passo 1 mediu à mão (10 créditos):

```bash
node --env-file-if-exists=.env scripts/comparar-passo1.ts
```

Checar se os dorks generalizam para outros cargos (~16 créditos por cargo):

```bash
node --env-file-if-exists=.env scripts/testar-cargos.ts --paginas=3
```

Ler os feeds do Google Alerts, sem Node e sem chave:

```bash
./scripts/alertas.sh -v
```

Todo script aceita `--dry-run`, que imprime o plano sem gastar crédito.

## Fontes

| | Serper.dev | Google Alerts |
|---|---|---|
| Entrega | acervo, sob demanda | só o que surge depois de criar o alerta |
| Consulta nova | chamada HTTP | criação manual, sem API |
| Operadores | `site:`, aspas, `tbs` | `site:`, aspas, negativos |
| Custo | 2.500 grátis (uma vez), depois ~$1/1.000 | grátis, sem cota |

A Serper é a fonte de produção. O Alerts é complemento gratuito para um conjunto fixo de buscas — não escala para cargo arbitrário.

## Como as consultas são montadas

O usuário informa **cargo + cidade**. Cada bloco vira duas consultas:

```
site:linkedin.com/jobs/view "<cargo>" "<cidade>"          → presencial e híbrido na cidade
site:linkedin.com/jobs/view "<cargo>" ("remoto" OR ...)   → remoto no Brasil inteiro
```

Todas com janela de 7 dias (`tbs=qdr:w`). Isso **não é só** uma restrição de produto: sem o filtro de data, um terço do que o índice devolve tem mais de 90 dias, e a ordenação por relevância esconde a vaga nova. Com o filtro, o volume de vagas recentes decuplica.

## Controle de créditos

Os 2.500 créditos gratuitos são **saldo único** com validade de 6 meses, não cota que zera por dia. O contador é acumulado em `.quota/serper.json`, e cada execução reserva antes de chamar e devolve o que não usou — inclusive quando quebra no meio.

```bash
cat .quota/serper.json
```

Retry consome crédito; falha de rede não. `402` (sem crédito) e `401` (chave errada) não fazem retry, porque não melhoram com insistência.

## Estrutura

```
src/
  collect.ts              orquestrador: reserva → busca → normaliza → dedup → grava
  config/alvos.ts         alvos de produção (cargo × cidade) + templates  ← edite aqui
  config/searches.ts      os 5 dorks do Passo 1, congelados como referência
  config/alertas.ts       os 5 alertas e as URLs dos feeds
  serper/cliente.ts       rate limit, retry, contabilidade de créditos   ← fonte de produção
  serper/normalizar.ts    resultado orgânico → linha de raw_results
  alerts/feed.ts          parser Atom do Google Alerts
  alerts/url.ts           desembrulha o redirect google.com/url?...
  alerts/normalizar.ts    entrada de feed → linha de raw_results
  normalize/url.ts        URL canônica + hash sha256   ← base da dedup
  normalize/datas.ts      data de publicação e sua origem
  normalize/texto.ts      limpeza de título e snippet
  dedupe.ts               dedup por hash + chave empresa+cargo do Passo 3
  quota/store.ts          reserva/devolução de saldo
  db/supabase.ts          PostgREST em fetch puro
  pse/tipos.ts            formato com pagemap; caminho alternativo, ver o arquivo
migrations/               SQL para o SQL Editor do Supabase, em ordem
scripts/                  medições
```

Rodar o coletor:

```bash
node --env-file-if-exists=.env src/collect.ts --dry-run
```

Aceita `--alvo=<id>`, `--paginas=N`, `--limite=N` e `--no-db` (usa contador em arquivo e não grava).

Só a camada de fonte é específica. `normalize/`, `dedupe`, `db` e as migrations são as mesmas para qualquer origem — foi o que permitiu trocar a fonte sem reescrever o pipeline.

## Setup

**Já feito** (24/08/2026): projeto Supabase `wagas` criado (`dvaflqmvnrelpuzhhmrr`, sa-east-1), migrations aplicadas, `.env` local preenchido. O coletor grava.

Para refazer do zero em outro ambiente:

1. Criar conta em [serper.dev](https://serper.dev) e pôr a chave em `SERPER_KEY` no `.env`
2. Aplicar `migrations/0001_*.sql` e `migrations/0002_*.sql` no SQL Editor do Supabase
3. Copiar a URL do projeto e a **secret key** (Settings → API Keys) para o `.env`
4. Secrets no repositório: `SERPER_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

A chave secreta ignora RLS: só em secret do Actions e em `.env` local, nunca no frontend. Serve tanto a nova `sb_secret_…` quanto a legacy `service_role`.

**O cron está no ar.** Repo privado em [OrdepPedro/wagas](https://github.com/OrdepPedro/wagas), rodando 1x/dia às 09:00 UTC (06h de Brasília). Os três secrets estão cadastrados e uma execução real foi validada: 4 consultas, 16 resultados já conhecidos deduplicados e 10 novos gravados.

**Cadência e duração do saldo.** O workflow roda 1x/dia. Com 7 alvos, 3 blocos, 2 recortes e 2 páginas são **84 créditos por rodada**, e os 2.500 gratuitos duram **~27 dias**. Rodar mais vezes por dia rende pouco — a janela é de 7 dias e o mesmo resultado voltaria quase inteiro, gasto em dobro. Subir `SERPER_PAGINAS` aumenta a cobertura e encurta a duração na mesma proporção.

> O GitHub desativa workflows agendados após 60 dias sem commit no repositório. Se a coleta parar sozinha, é isso.

## Decisões que estão no código por um motivo

**Canonicalização agressiva por fonte.** A mesma vaga chega como `br.linkedin.com/jobs/view/product-manager-at-acme-4012345678?refId=…` e como `www.linkedin.com/jobs/view/4012345678`. As duas viram a mesma URL. O subdomínio da Gupy é preservado — ele identifica a empresa.

**`autocorrect: false` na Serper.** Ligado, o Google reescreve o dork e você mede outra consulta.

**Dupla decodificação de entidades.** Um `&` do texto chega como `&amp;amp;` e as tags de destaque como `&lt;b&gt;`. Decodificar `&lt;`/`&gt;` antes de remover tags, e passar em `&amp;` duas vezes.

**Alerts e Serper rodam o mesmo dork.** Um teste compara `alertas.consulta` com `combo.dork` por id. Já divergiu uma vez — o alerta de post ficou sem `intitle:` — e isso faria a comparação medir dork diferente em vez de fonte diferente.

**`jobs` existe e fica vazia.** O coletor não escreve nela. Está aqui porque `dedup_key = empresa + cargo normalizado` é decisão de schema, e retrofit custa migração.

## O que este passo não resolve

- **Migrations não aplicadas.** Enquanto isso, rode com `--no-db`; os resultados de medição ficam em JSON solto na raiz.
- **Posts precisam de solução melhor.** Funcionam e generalizam, mas 26% dos títulos são genéricos e a extração de empresa/cargo exige buscar o corpo da página.
- **Dedup semântica.** A mesma vaga anunciada na Gupy e repostada como post tem URLs diferentes; o hash não pega. Precisa de pgvector sobre o texto extraído — Passo 3.
- **Gupy é fonte única de ATS.** Risco registrado, não resolvido.
