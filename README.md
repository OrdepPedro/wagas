# wagas — coletor e classificador (Passos 2 e 3)

**Coletor.** Busca vagas dos últimos 7 dias em três blocos — LinkedIn Jobs, posts do LinkedIn e Gupy —, normaliza, deduplica e grava em `raw_results`.

**Classificador.** Lê `raw_results`, decide o que é vaga de verdade do cargo buscado, extrai empresa/cargo/senioridade e grava em `jobs`. Duas etapas: um pré-filtro determinístico que custa zero e um LLM em tier gratuito só no que sobrou.

**Harness.** 120 casos rotulados a partir de SERP real, em 6 cargos e 3 fontes. É ele que diz se o classificador pode ir para o feed — não a impressão de que "pareceu certo".

Zero dependência de runtime. Node 24 executa TypeScript direto (type stripping), então não há build, não há `npm ci` no CI e os testes rodam sem instalar nada.

> **A Google Programmable Search morreu.** Fechada a novos projetos em 2025, desligada em 01/01/2027. A fonte de produção agora é a **Serper.dev**. Ver o CLAUDE.md para o histórico e as alternativas avaliadas.

## Rodar

```bash
npm test
```

Medir o classificador contra o golden set, sem chave e sem custo:

```bash
npm run harness:prefiltro
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

Os 2.500 créditos gratuitos são **saldo único** com validade de 6 meses, não cota que zera por dia. Cada execução reserva antes de chamar e devolve o que não usou — inclusive quando quebra no meio.

Em produção o contador vive na tabela `api_saldo` (chave `serper`), com reserva atômica via `SELECT … FOR UPDATE`. Rodando com `--no-db`, ele cai em `.quota/serper.json` local — os dois são independentes e não se sincronizam sozinhos.

Retry consome crédito; falha de rede não. `402` (sem crédito) e `401` (chave errada) não fazem retry, porque não melhoram com insistência.

## Estrutura

```
src/
  collect.ts              coletor:      reserva → busca → normaliza → dedup → grava
  classify.ts             classificador: lê pendentes → pré-filtro → LLM → grava em jobs
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
  classificar/familia.ts       regra genérica de família de cargo   ← o coração do Passo 3
  classificar/prefiltro.ts     as decisões que custam zero
  classificar/prompt.ts        prompt e contrato JSON estrito
  classificar/llm.ts           Gemini Flash-Lite + Groq de reserva
  classificar/classificador.ts orquestra os dois estágios
  classificar/persistencia.ts  lê raw_results, grava jobs
  classificar/harness.ts       precisão, recall, F1 por estágio
  dedupe.ts               dedup por hash + chave empresa+cargo usada em jobs
  quota/store.ts          reserva/devolução de saldo
  db/supabase.ts          PostgREST em fetch puro
  pse/tipos.ts            formato com pagemap; caminho alternativo, ver o arquivo
migrations/               SQL para o SQL Editor do Supabase, em ordem
harness/golden.jsonl      120 casos rotulados   ← edite aqui para corrigir um rótulo
scripts/harness.ts        roda o harness e imprime o relatório
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
2. Aplicar `migrations/0001_*.sql`, `0002_*.sql` e `0003_*.sql` no SQL Editor do Supabase
3. Copiar a URL do projeto e a **secret key** (Settings → API Keys) para o `.env`
4. Secrets no repositório: `SERPER_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` e, para classificar, `GEMINI_KEY` (opcional: `GROQ_KEY`)

A chave secreta ignora RLS: só em secret do Actions e em `.env` local, nunca no frontend. Serve tanto a nova `sb_secret_…` quanto a legacy `service_role`.

**A coleta roda sob demanda, não em cron.** Repo privado em [OrdepPedro/wagas](https://github.com/OrdepPedro/wagas), com os três secrets cadastrados. Uma execução real foi validada pelo Actions: 4 consultas, 16 resultados já conhecidos deduplicados e 10 novos gravados.

Para disparar:

```bash
gh workflow run coletor.yml --repo OrdepPedro/wagas -f paginas=2
```

Aceita também `-f dry_run=true`, `-f alvo=<id>` e `-f limite=N`.

**Custo por rodada.** Com 7 alvos, 3 blocos, 2 recortes e 2 páginas são **84 créditos**. O saldo gratuito é de 2.500 e não renova, então cada disparo conta. Enquanto não houver front-end lendo o banco, coletar em cron seria gastar para ninguém — por isso o `schedule` está comentado no workflow, pronto para religar.

> Sem coleta periódica o projeto do Supabase fica ocioso, e o plano free **pausa projeto ocioso**. Se voltar depois de algumas semanas e a coleta falhar na conexão, é isso: despause pelo dashboard e rode de novo.

## Classificador (Passo 3)

```bash
npm run classify -- --dry-run      # decide e imprime, não grava
npm run classify -- --so-prefiltro # sem gastar cota de LLM
npm run classify
```

Dois estágios, e a ordem é o desenho de custo:

| estágio | custo | o que decide |
|---|---|---|
| pré-filtro | zero | página de listagem da Gupy, vaga fora dos 7 dias, cargo de outra família pelo título |
| LLM | cota de tier gratuito | é vaga mesmo? o cargo bate? **o local serve?** empresa, cargo, senioridade, modelo |

**O local é a promessa do produto, não preferência:** presencial e híbrido só na cidade buscada; remoto vale o Brasil inteiro. Cidade que aparece no nome da empresa, no perfil de quem publicou ou em hashtag **não** é o local da vaga — uma vaga home office anunciada por empresa de Aracaju continua servindo para quem busca em São Paulo. O portão só fecha com evidência: local não mencionado passa, senão a maioria das vagas cairia por silêncio do título.

**O pré-filtro nunca filtra post por título.** O `title` que a API devolve para `linkedin_post` não é o `<title>` da página — o Google reescreve para "Publicação de Fulano". Esse filtro já foi aplicado na origem, pelo `intitle:` do dork; aplicar de novo aqui descartaria vaga boa.

**Família de cargo é regra genérica, não lista de exceções.** `familia.ts` decompõe qualquer título em senioridade + função + domínio. Dois cargos são da mesma família quando compartilham o domínio e a *classe* da função. Daí sai, sem nenhuma linha citando esses cargos: Product Owner bate com Product Manager, Assistente Administrativo bate com Auxiliar Administrativo, Product Designer **não** bate com Product Manager. Cargo novo no produto não deve exigir mexer no léxico — se exigir, a regra está errada.

**Erro de infraestrutura não vira veredito.** Cota estourada, rede caindo ou resposta ilegível marcam o item como `erro` e **não** marcam `processado`: ele volta na próxima rodada. Aprovar ou reprovar por omissão gravaria uma decisão que ninguém tomou.

**Sem empresa identificada, a chave de dedup cai para o id da fonte.** Usar `empresa + cargo` com empresa vazia colapsaria todas as vagas do mesmo cargo numa só. `jobs.dedup_por_empresa` registra quando isso aconteceu, para não confundir "não deduplicou" com "não havia duplicata".

## Harness de avaliação

```bash
npm run harness:prefiltro          # sem chave, sem custo
npm run harness                    # inclui o LLM, se houver chave
npm run harness -- --json=saida.json
```

O golden set (`harness/golden.jsonl`) tem **120 casos** vindos de SERP real: 95 da medição de generalização por cargo (23/08) e 25 da reprodução do Passo 1 (22/08). Seis cargos, três fontes, dois recortes. Para corrigir um rótulo, edite a linha — o arquivo é a fonte de verdade, não um artefato gerado.

Rótulo = **é uma vaga aberta E o cargo é da família do cargo buscado**. Três valores: `relevante` (77), `irrelevante` (20), `indeterminado` (23).

**A métrica que manda é recall, não precisão.** Falso negativo — vaga boa descartada — é invisível para o usuário e irreversível, porque a linha já foi marcada como processada. Falso positivo é visível e o usuário perdoa um ou dois. Por isso o recall aparece por estágio: **o recall do pré-filtro é o teto do produto inteiro**, já que o LLM não recupera o que o pré-filtro cortou.

### O que está medido hoje (24/08/2026)

Golden set com **124 casos**. Eixo de cargo ("é vaga E o cargo bate?"), sobre os 99 rotuláveis, com `gemini-3.5-flash-lite`:

| estágio | precisão | recall | F1 |
|---|---|---|---|
| pré-filtro isolado | 87% | 100% | 93% |
| **pipeline completo** | **100%** | **95%** | **97%** |

Por fonte, no pipeline completo: `ats_gupy` 100/100, `linkedin_job` 100/97, `linkedin_post` 100/84.

Eixo de local, medido separado (`rotuloLocal`: 35 `sim`, 3 `nao`, 86 `indeterminado`):

```
casos avaliáveis: 36   acertos: 35
fechou numa vaga de local bom (some com a vaga): 0
deixou passar vaga de outra cidade (lixo no feed): 1
```

**Os dois eixos são separados de propósito.** Rejeição por `local_nao_serve` não conta como falso negativo de cargo — ao ligar o portão sem essa separação, o recall aparente caiu de 95% para 84% e parecia que o classificador tinha piorado; era o portão funcionando, contado no eixo errado.

O LLM derrubou **todos os 11 falsos positivos** que o pré-filtro tinha deixado passar — inclusive "Global Product Line Manager — Screens" e "[TEAM PRODUCT] Flutter flow Lead PL", as classes que o Passo 1 tinha nomeado. Zero lixo chegaria ao feed nesta amostra.

Custo: 14 chamadas para 111 candidatos, lote de 8. Tier gratuito, nenhum centavo.

**Os 4 falsos negativos, um a um** — é o erro caro, então vale olhar:

| caso | motivo | leitura |
|---|---|---|
| Analista de Engenharia de Dados | `cargo_de_outra_familia` | discordância de rótulo: eu marquei como adjacente, o modelo diz que não. Decisão de produto, não defeito |
| Analista de Business Intelligence | `confianca_baixa` (0,40) | post sem snippet no golden set |
| VAGA ADMINISTRATIVA VIA LINKEDIN | `confianca_baixa` (0,40) | post sem snippet no golden set |
| Enfermeiro(a) Auditor(a) | `confianca_baixa` (0,40) | título curto, sem snippet |

Três dos quatro são o mesmo problema: **falta de snippet no golden set**, não erro de julgamento.

**O canal de confiança está funcionando.** Dos 17 itens reprovados por `confianca_baixa`, 14 são exatamente os casos que eu não consegui rotular à mão — o modelo chegou sozinho ao mesmo conjunto de "não dá para saber". O limiar de 0,6 é o que separa "estou vendo a vaga" de "estou chutando", e custa 3 vagas boas em 77. Com precisão em 100%, há folga para baixá-lo; é decisão de produto.

### O que ainda NÃO está medido, e por quê

**Uma rodada não é uma medição.** Duas execuções do mesmo golden set deram 4 falsos negativos cada, mas **não os mesmos quatro** — mesmo com `temperature: 0`. Antes de tratar 95% como número, rodar três vezes e olhar a variação.

**Precisão de 100% saiu de 20 negativos.** Vinte casos irrelevantes. O intervalo de confiança é largo: esse resultado é compatível com uma precisão verdadeira bem abaixo de 100%. Negativo é raro na amostra porque a SERP de origem já tinha ~90% de precisão.

**O golden set não tem snippet.** As medições de 22 e 23/08 guardaram só título e URL, e é isso que explica 3 dos 4 falsos negativos e 14 dos 17 `confianca_baixa`. Em produção o snippet existe — então o número de `linkedin_post` aqui (89% de recall) é **piso**, não estimativa. Recoletar guardando o snippet é o próximo passo do harness.

**O pré-filtro corta pouco: 9 de 120 (7,5%).** A economia de cota que justifica o estágio não está demonstrada, e o golden set não é amostra aleatória (6 títulos por cargo×bloco), então 7,5% não estima produção. A taxa real precisa sair de `raw_results` — é para isso que `classificacao_motivo` existe na migration 0003.

**Localização não é medida.** O rótulo responde "é vaga e o cargo bate?". Remoto dos EUA vs. remoto do Brasil segue sem número, e o produto promete remoto **do Brasil**.

**O Groq nunca rodou.** É a reserva para quando a cota diária do Gemini estourar, e está testado só contra `fetch` injetado. O id de modelo padrão pode estar velho — foi exatamente o que aconteceu com o Gemini: `gemini-2.5-flash-lite` respondeu `404 — no longer available to new users`.

## Decisões que estão no código por um motivo

**Canonicalização agressiva por fonte.** A mesma vaga chega como `br.linkedin.com/jobs/view/product-manager-at-acme-4012345678?refId=…` e como `www.linkedin.com/jobs/view/4012345678`. As duas viram a mesma URL. O subdomínio da Gupy é preservado — ele identifica a empresa.

**`autocorrect: false` na Serper.** Ligado, o Google reescreve o dork e você mede outra consulta.

**Dupla decodificação de entidades.** Um `&` do texto chega como `&amp;amp;` e as tags de destaque como `&lt;b&gt;`. Decodificar `&lt;`/`&gt;` antes de remover tags, e passar em `&amp;` duas vezes.

**Alerts e Serper rodam o mesmo dork.** Um teste compara `alertas.consulta` com `combo.dork` por id. Já divergiu uma vez — o alerta de post ficou sem `intitle:` — e isso faria a comparação medir dork diferente em vez de fonte diferente.

**`jobs` existe e fica vazia.** O coletor não escreve nela. Está aqui porque `dedup_key = empresa + cargo normalizado` é decisão de schema, e retrofit custa migração.

## O que estes passos não resolvem

- **Posts precisam de solução melhor.** Funcionam e generalizam, mas o título vem reescrito e a extração de empresa/cargo exige buscar o corpo da página — uma requisição a mais por item.
- **Dedup semântica.** A mesma vaga anunciada na Gupy e repostada como post tem URLs diferentes e, quando o nome da empresa sai diferente nas duas, `dedup_key` também não pega. Precisa de pgvector sobre o texto extraído.
- **Gupy é fonte única de ATS.** Risco registrado, não resolvido.
- **Nada lê o banco ainda.** `jobs` só vira produto no Passo 4.
