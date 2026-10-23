# wagas — contexto do projeto

Agregador de vagas de emprego. O usuário informa cargo e cidade, e recebe um feed de oportunidades dos últimos 7 dias.

**Diferencial (redefinido pelo Pedro em 19/10/2026):** achar a vaga E ter uma IA que lê a descrição e adapta o currículo do candidato àquela vaga.

⚠️ **Adaptar currículo com IA, sozinho, é commodity** — Teal, Jobscan, Kickresume, LinkedIn Premium, e qualquer um cola vaga + CV no ChatGPT de graça. O defensável é o **encaixe**: vaga certa e CV adaptado no mesmo lugar, sem copiar e colar. Se o feed não for bom, o resto é um wrapper de LLM.

**Duas consequências que mudam o projeto:**
1. **A descrição completa da vaga virou requisito de fonte.** Sem o corpo da vaga não há o que adaptar. Fonte que só entrega título e snippet (SERP do LinkedIn) passa a ser fonte de segunda classe.
2. **Currículo é dado pessoal.** LGPD, consentimento e retenção entram no desenho desde o primeiro usuário, não depois.

**Saíram do diferencial:** o post de recrutador do LinkedIn (rebaixado em 28/08, achado 27) e o Telegram (medido em 29/08, achado 35, **descartado pelo Pedro em 19/10**; código removido, medição preservada no commit "Mede o Telegram como fonte").

**Produto multiusuário.** Não é ferramenta pessoal do Pedro. Qualquer validação feita só com o perfil dele (Product Manager, Belo Horizonte) é amostra enviesada e estreita — teste com segmentos variados.

---

## Premissa do produto (definida em 23/08/2026)

- **Janela fixa de 7 dias.** Não existe seletor de período. Se a vaga tem mais de 7 dias, não entra.
- **O usuário informa cargo + cidade.** Nada mais.
- **O feed junta três coisas:** vagas presenciais na cidade dele, híbridas na cidade dele, e remotas de todo o Brasil.
- ~~**No free tier não há seleção de modelo de trabalho**~~ — **revogado em 26/08 pelo Pedro.** Existe um toggle "Só vagas remotas". Ele NÃO é um filtro a mais sobre o feed: ligado, a cidade deixa de valer e o feed vira remoto de todo o Brasil. Somá-lo ao feed normal devolveria só a vaga remota que por acaso registrou a cidade da pessoa, que é quase nenhuma.
- **O usuário busca qualquer cargo e recebe resultado** — decidido em 26/08, com consulta nova a cada troca de cargo ou cidade, e teto diário no tier gratuito. Ver a exceção registrada à regra crítica, abaixo.
- **Fontes por vaga:** LinkedIn Jobs, posts do LinkedIn e Gupy.
- **Tiers pagos** vão diferenciar precisão e quantidade. O desenho ainda não existe.

Consequência direta na coleta: cada par cargo×cidade vira **duas consultas por bloco** — uma com a cidade, outra com os termos de remoto.

---

## Restrições inegociáveis

1. **Custo inicial zero para validar.** A validação tem que caber em tier gratuito. Custo de produção existe e é esperado (o produto terá tiers pagos), mas qualquer proposta que exija pagamento **antes** de haver dado de retenção deve ser marcada como fora de escopo, com a alternativa gratuita ao lado.

2. **Nada de scraping do LinkedIn autenticado.** Extensão que lê o DOM logado, automação de sessão ou uso de endpoints internos estão descartados: violam o Termo de Uso e arriscam banir a conta do próprio usuário. Se o Pedro pedir algo assim, recuse e lembre o motivo.

3. **Fontes válidas:** APIs de SERP que devolvam URL real e honrem operadores, alertas de e-mail/RSS que o próprio usuário configura, APIs abertas de agregadores (Remotive, RemoteOK, Arbeitnow, Himalayas, Jooble, Adzuna), ATSs públicos (Gupy; Greenhouse, Lever e Ashby por empresa) e — **ampliado pelo Pedro em 20/10/2026** — **portais de vaga brasileiros públicos lidos pela página**.

   Condições do scraping de portal, todas obrigatórias: página pública sem login nem cookie; `robots.txt` permitindo o caminho; dado lido do JSON-LD `JobPosting` que o próprio site publica, não do resto do HTML (achado 1); no máximo uma requisição por segundo; **só na coleta, nunca no request do usuário**. A restrição 2 não muda: LinkedIn autenticado continua proibido. Primeiro portal adotado: **InfoJobs** (achado 37). Hays (robots proíbe) e Catho (anti-bot) ficam fora por essas condições, não por escolha.

   **Exceção decidida pelo Pedro em 22/10 (achado 39):** quando a página não publica `JobPosting`, vale ler o HTML **do bloco da própria vaga**, delimitado por um marcador fixo antes da lateral de outras vagas (no InfoJobs, `id="divSimilarVacancies"`). Sem o marcador, a página é recusada. A data lida assim só tem precisão de dia e é gravada com origem `pagina_html`, nunca `metatag`.

---

## A PSE morreu — 22/08/2026

A **Google Programmable Search / Custom Search JSON API** foi fechada a novos clientes em 2025 e será **desligada em 01/01/2027**, inclusive para quem já usa.

Sintoma: `403 PERMISSION_DENIED — "This project does not have the access to Custom Search JSON API"`, com `reason: forbidden`, em projeto novo com a API ativada e a chave corretamente restrita. Não é erro de configuração e não tem contorno.

Toda a arquitetura de coleta foi refeita por causa disso.

### Alternativas avaliadas

| Opção | Veredito |
|---|---|
| **Serper.dev** | ✅ **escolhida.** SERP real do Google, honra `site:`/aspas/`tbs`, devolve URL real. 2.500 créditos grátis (uma vez, 6 meses), depois ~$1/1.000 |
| **Google Alerts (RSS)** | ✅ complemento gratuito, com limites sérios — ver abaixo |
| **DataForSEO** | 💰 mais barato em escala ($0,60/1.000), depósito mínimo $50. Fora de escopo até haver dado de retenção |
| **Vertex AI Search** | 💰 substituto oficial do Google, com restrição por domínio. Pago, sem tier gratuito real |
| **Grounding do Gemini** | ❌ **não serve.** 5.000/mês grátis é isca: devolve redirect opaco `vertexaisearch.cloud.google.com/...`, sem URL real. Quebra canonicalização, dedup e `fonte_id`. O `title` só traz o domínio, então nem dá para separar `/jobs/view` de `/posts` |
| **Brave Search API** | ❌ matou o free tier em fev/2026 |

### Google Alerts: o que serve e o que não serve

Serve como fonte gratuita e ilimitada para um conjunto **fixo e curado** de buscas. Honra `site:`, aspas e negativos — verificado.

Não serve como fonte única, por dois motivos estruturais:

1. **Só entrega fluxo, nunca acervo.** Um alerta criado hoje não devolve nada do que já existe. Usuário novo em cargo novo veria feed vazio.
2. **Não tem API de criação.** Criar alerta é clique a clique na interface — verificado na prática. Para produto onde o usuário digita cargo e cidade arbitrários, isso não escala.

Cinco alertas ativos na conta `pedroafontoura3@gmail.com`, com os dorks validados, entrega em RSS. IDs dos feeds em `src/config/alertas.ts`.

---

## Arquitetura decidida

| Camada | Escolha |
|---|---|
| Coleta | GitHub Actions chamando a **Serper.dev** — hoje sob demanda, cron previsto para quando houver front-end |
| Complemento | Feeds RSS do Google Alerts para segmentos fixos |
| Classificação | pré-filtro regex barato → Gemini Flash-Lite, Groq como fallback, saída JSON estrito |
| Banco | Supabase (Postgres, Auth, pgvector para dedup semântica) |
| Backend | Cloudflare Workers |
| Frontend | Next.js na Vercel |
| Ingestão de e-mail | Cloudflare Email Routing + Worker |

**Regra crítica:** busca **nunca** é disparada por request de usuário. A coleta popula o cache; o usuário lê o cache. Filtros de cargo, modelo, local e período são aplicados **no Postgres sobre o cache** — traduzir filtro de usuário em consulta à API multiplicaria o custo pela combinatória.

Isso vale independentemente de a coleta rodar em cron ou sob demanda: o que a regra proíbe é o caminho request-do-usuário → **API paga**.

**Exceção registrada em 26/08, e ela é menor do que parece.** O Pedro decidiu que o usuário busca qualquer cargo e recebe resultado. Isso NÃO quebrou a regra, porque a fonte que atende o request é gratuita: a API pública do portal da Gupy (achado 24). O caminho continua sendo `coleta popula o cache → usuário lê o cache`; o que mudou foi quem puxa o gatilho e quanto custa — nada.

O que continua **proibido** é a Serper no request. Ela mora em `scripts/coletar-demanda.ts`, fora do caminho do usuário, ordenada por pessoas distintas que pediram e não acharam, com teto por execução e último passo manual. A aritmética que sustenta isso: restam 2.133 créditos, não renovam, ~18 por par cargo×cidade — **~118 pares na vida inteira do produto**. Uma pessoa trocando de cargo dez vezes numa tarde consumiria 8% disso.

A economia da regra vale igual para a fonte gratuita, só que a moeda é outra: `coletas_sob_demanda` impede dez usuários pedindo o mesmo par de virarem dez varreduras num serviço de terceiro que não nos deve nada.

**Consequência econômica que importa:** o custo escala com **pares cargo×cidade distintos**, não com número de usuários. Dez usuários pedindo "Product Manager em São Paulo" custam uma varredura, não dez.

---

## Estado atual

### Passo 1 — validado (com correções)

Detalhes originais em `passo1-google-dorks.md`. O que continua valendo: os dorks funcionam, com precisão medida de ~90–100%.

**Correção importante:** o Passo 1 concluiu que filtro de data era redundante no LinkedIn porque "o índice já é fresco". Isso está **errado** para o produto atual. Medição de 22/08: sem filtro de data, um terço do que o índice devolve tem mais de 90 dias — a busca por relevância enterra a vaga nova. Com `tbs=qdr:w`, o volume de vagas recentes **decuplica**.

O filtro de 7 dias não é só uma restrição de produto: é ganho de recall.

### Passo 2 — coletor funcionando

Node 24 + TypeScript, zero dependência de runtime (type stripping nativo, PostgREST em fetch puro). 114 testes, typecheck limpo.

**Supabase provisionado em 24/08/2026:** projeto `wagas`, ref `dvaflqmvnrelpuzhhmrr`, região `sa-east-1`, org `OrdepPedro's Org`. As três migrations foram aplicadas e verificadas — `raw_results`, `jobs`, `collection_runs`, `api_saldo`, as funções `reservar_saldo`/`devolver_saldo` e as colunas de classificação da `0003` existem. `jobs` deixou de estar vazia em 24/08: 20 linhas gravadas pela primeira rodada do classificador.

Autenticação pela **secret key nova** (`sb_secret_…`), não pela legacy `service_role`. As duas funcionam nos headers do PostgREST; a nova é o caminho que o Supabase está adotando.

Teste ponta a ponta: 20 vagas coletadas e gravadas; segunda rodada devolveu `jaNoBanco: 20, gravados: 0`, provando a dedup contra o banco.

### Passo 3 — classificador medido ponta a ponta (24/08/2026)

Pipeline de dois estágios em `src/classificar/`: pré-filtro determinístico (custo zero) → Gemini Flash-Lite com Groq de reserva, saída JSON estrito em lote. Migration `0003` grava o motivo da decisão em `raw_results`, para o harness poder medir cada regra sobre dado de produção. 181 testes, typecheck limpo.

**Família de cargo virou regra genérica**, como o CLAUDE.md exigia: `familia.ts` decompõe qualquer título em senioridade + função + domínio, e duas vagas são da mesma família quando compartilham o domínio e a *classe* da função. Product Owner ≈ Product Manager, Assistente ≈ Auxiliar, Cientista de Dados ≈ Analista de Dados — sem nenhuma linha citando esses cargos. Product Designer não bate com Product Manager (mesmo domínio, outra classe).

**Harness com 120 casos rotulados** de SERP real (`harness/golden.jsonl`): 6 cargos, 3 fontes. 77 relevantes, 20 irrelevantes, 23 indeterminados. `indeterminado` fica fora da métrica de propósito — rotular no chute inventaria o número.

Pré-filtro isolado, sobre os 97 rotuláveis: **recall 100%, precisão 88%**. Por fonte: Gupy 100/100, LinkedIn Jobs 93/100, posts 69/100. Um teste trava o recall em 100% — regra nova que corte vaga boa quebra a suíte.

**Pipeline completo, com `gemini-3.5-flash-lite`: precisão 100%, recall 95%, F1 97%** (97 casos). O LLM derrubou os 11 falsos positivos que o pré-filtro deixara passar, inclusive as classes nomeadas no Passo 1. 14 chamadas para 111 candidatos; tier gratuito, custo zero. Relatório em `harness-2026-08-24.json`.

**O modelo padrão que eu tinha escolhido estava morto.** `gemini-2.5-flash-lite` devolve `404 — no longer available to new users`, apontando para `gemini-3.5-flash-lite`. Um teste de fumaça com 16 casos custou 2 chamadas e pegou isso antes da rodada inteira — id de modelo velho é falha silenciosa até a primeira chamada real. O padrão do Groq (`llama-3.3-70b-versatile`) nunca foi exercitado e pode estar no mesmo estado.

**O canal de confiança funciona.** Dos 17 reprovados por `confianca_baixa`, 14 são exatamente os casos que eu não consegui rotular à mão — o modelo chegou sozinho ao mesmo conjunto de "não dá para saber". Foi preciso instruir explicitamente que **ausência de evidência não é evidência de ausência**: na primeira rodada ele marcava `ehVaga: false` para post sem texto, o que descarta vaga em silêncio. Agora isso cai como `confianca_baixa`, que é visível e separável no relatório.

**Primeira rodada em produção (24/08, pelo Actions).** Migration 0003 aplicada; 30 pendentes de `raw_results` classificados; `jobs` saiu de 0 para 20 linhas, com empresa/cargo/senioridade/modelo extraídos. Zero erro, 17s. 21 aprovadas, 1 colapsada pela dedup, 3 cortadas pelo pré-filtro, 6 pelo LLM.

As classes de falso positivo nomeadas no Passo 1 morreram em dado real, não só no golden set: "Líder de Produtos Financeiros", "Líder de Produtos e Serviços Financeiros" e "products executive manager - shopping & loop mkp" foram todas rejeitadas pelo LLM com motivo correto. A adjacência também funcionou: 4 Product Owners entraram numa busca por Product Manager.

**Mas as 30 linhas eram todas Product Manager** — o cargo com 100% de recall também no harness. Nada nessa rodada diz o que acontece com Enfermeiro ou Auxiliar Administrativo em produção. Para saber: rodar o coletor nos outros alvos (~84 créditos) e classificar de novo; aí `classificacao_motivo` acumula distribuição por cargo, que é a conta que nem o golden set nem essas 30 linhas dão.

**Segunda rodada, 248 itens em 5 cargos novos (24/08).** `jobs` foi para 197 linhas. É a primeira medição com segmento variado — e ela CORRIGE a leitura da primeira:

| cargo | total | aprovados | % | corte pré | corte LLM |
|---|---|---|---|---|---|
| Auxiliar Administrativo | 71 | 49 | 69% | 20 | 2 |
| Analista de Marketing | 54 | 38 | 70% | 14 | 2 |
| Product Designer | 45 | 31 | 69% | 11 | 3 |
| Analista de Dados | 43 | 31 | 72% | 11 | 1 |
| Desenvolvedor Front-end | 35 | 31 | 89% | 4 | 0 |
| Product Manager | 30 | 21 | 70% | 3 | 6 |

| fonte | total | aprovados | % |
|---|---|---|---|
| linkedin_job | 202 | 149 | 74% |
| linkedin_post | 19 | 18 | 95% |
| ats_gupy | 57 | 34 | 60% |

**Product Manager concentra o corte do LLM** — 6 de 30, contra 0 a 3 em todos os outros. É o cargo de termo mais ambíguo em português ("produtos financeiros", "produtos e serviços"), e é ele que exige julgamento caro. Nos demais o pré-filtro resolve quase sozinho. **Front-end é o mais limpo**, 89%: título de vaga tech é literal.

**CORREÇÃO — o pré-filtro corta 24%, não 10%.** Ficou escrito aqui, com base nos 30 primeiros itens, que "a economia de cota que justifica o estágio não está acontecendo". Estava errado, e o erro foi tirar conclusão de amostra enviesada: aqueles 30 eram 100% Product Manager e quase todos de `linkedin_job`, a combinação onde o pré-filtro tem menos o que fazer. Com 6 cargos e Gupy no meio, ele corta 60 de 248 — `cargo_fora_do_titulo` 43 e `pagina_de_listagem` 17. A justificativa no cabeçalho de `prefiltro.ts` está de pé.

**O que este passo NÃO provou:**

1. **Uma rodada não é medição.** Duas execuções do mesmo golden set deram 4 falsos negativos cada, mas **não os mesmos quatro**, com `temperature: 0`. Rodar três vezes antes de tratar 95% como número.
2. **Precisão de 100% saiu de 20 negativos.** Intervalo de confiança largo. Compatível com precisão verdadeira bem abaixo disso.
3. **O golden set não tem snippet** — explica 3 dos 4 falsos negativos e 14 dos 17 `confianca_baixa`. O recall de `linkedin_post` (89%) é **piso**, não estimativa: em produção o snippet existe.
4. **O pré-filtro corta pouco: 9 de 120 (7,5%).** A economia de cota que justifica o estágio não está demonstrada, e o golden set não é amostra aleatória — medir sobre `raw_results` via `classificacao_motivo`.
5. **Localização não é medida.** Remoto dos EUA vs. remoto do Brasil segue sem número, e o produto promete remoto do Brasil.
6. **O Groq nunca rodou.**

### Passo 4 — base do feed pronta, tela pendente (25/08/2026)

O Passo 4 começou pelo dado, não pela tela, porque o feed é uma consulta com quatro predicados — cargo, cidade, modelo e janela de 7 dias — e **nenhum dos quatro existia como coluna consultável**. Medido sobre as 197 linhas de `jobs`:

| predicado | estado ao entrar no Passo 4 |
|---|---|
| cargo | `cargo_normalizado` com 15+ valores distintos para 6 cargos. Igualdade devolve quase nada, e `ilike` não sabe que Product Owner é da família de Product Manager |
| cidade | `localizacao` é texto livre do LLM: 25 grafias de São Paulo, 42 nulls, "Green Bay, Wisconsin" no meio |
| modelo | null em 114 de 197 (58%) |
| janela | `data_publicacao` null em 197 de 197 |

**Migration `0004_feed.sql`** dá as colunas que faltavam: `familia_tokens` e `familia_classes` (arrays com índice GIN), `cidade_slug`, `uf`, `pais_br`, `local_avaliado`, `data_publicacao_origem` e a coluna gerada `data_referencia`.

**O filtro de família virou SQL sem virar uma segunda regra.** `familia_tokens @> ARRAY[...]` é a condição 1 de `cargoBateNoTitulo` (todo domínio do cargo buscado está no título); `familia_classes && ARRAY[...]` é a condição 2 (ao menos uma função da mesma classe). Um teste roda 12 pares cargo×título pelos dois caminhos e exige o mesmo veredito — porque duas implementações que divergem produzem feed vazio sem causa aparente, que é o pior modo de falha deste produto.

**`pais_br` tem três estados de propósito.** `true` Brasil confirmado, `false` fora confirmado, `null` não deu para saber. Colapsar `null` em `false` esconderia vaga brasileira que o anúncio não qualificou; colapsar em `true` deixaria a vaga remota da França no feed. A composição do feed é `cidade_slug = <a dele>` OU (`modelo = remoto` E `pais_br IS NOT FALSE`).

**A janela de 7 dias está declarada, não cumprida.** `data_referencia = coalesce(data_publicacao, data_coleta)` é coluna gerada para o predicado ser indexável, e o comentário no schema diz o que ela é: com `data_publicacao` null na maioria, `data_referencia >= now() - 7 dias` entrega uma janela real de **até 14 dias**, porque um item coletado ontem já tinha até 7. O achado 19 fechou a saída fácil — a data relativa do LinkedIn não serve. Só a data de publicação de verdade resolve.

**Reclassificação completa em 25/08.** As 278 linhas voltaram para a fila e passaram pelo pipeline com o portão de local ligado: 63 cortadas no pré-filtro (número idêntico ao da rodada anterior — o controle determinístico), 20 no LLM, **195 aprovadas, 192 gravadas**. `jobs` está com `local_avaliado = true` em 100% das linhas e zero vaga estrangeira. Detalhe dos vereditos de local no achado 22, e da variação entre rodadas no achado 23.

Estado do acervo depois disso: 105 linhas em `sao-paulo`, `pais_br` confirmado em 146 e desconhecido em 46, **`modelo` ainda null em 102 de 192 (53%)**, `data_publicacao` null em 192 de 192, empresa não identificada em 54 (28%).

O feed responde hoje, com janela de 7 dias, em São Paulo: Auxiliar Administrativo 39, Analista de Marketing 34, Analista de Dados 32, Front-end 28, Product Designer 26, Product Manager 14. "Enfermeiro" devolve vazio — cargo não coletado, que é o estado vazio previsto.

**A precisão do feed é a do pré-filtro, não a do pipeline.** No Passo 3 o LLM julgava cada vaga contra o cargo que a coletou; no feed a pergunta de família é refeita contra o cargo que o USUÁRIO digitou, e ali não há LLM. Medido: 3 vazamentos em 192 linhas servidas (2%), todos na família `product` — e concentrados, porque no feed de Product Manager duas das 14 linhas são de design (`Technical Lead Product Designer`, `Product Design`). Testei o eixo alternativo, filtrar pelo `cargo_busca` que o LLM validou: 2 falsos positivos e 3 falsos negativos, contra 3 e 2. **Empatam** — a troca moveria 5 linhas em 192 e não resolve o problema estrutural, então o eixo ficou como está.

**A tela existe desde 25/08.** Next.js 16 (App Router) + Supabase Auth por link mágico, em `web/`. Três estados numa página só: sem sessão → e-mail; com sessão e sem perfil → cargo + cidade; com perfil → feed.

**`web/` importa `../src` em vez de copiar.** `lib/feed.ts` chama o mesmo `consultaDeFeed` que `scripts/consultar-feed.ts` usa, e `lib/perfil.ts` usa o mesmo `slugCidade` que gravou `jobs.cidade_slug`. Copiar esses módulos para dentro do Next criaria uma segunda implementação da regra de família e da normalização de cidade — e o sintoma de as duas divergirem é feed vazio sem causa aparente, que é a falha mais cara deste produto. O `outputFileTracingRoot` no `next.config.ts` é o que faz o build enxergar a pasta de fora.

**A leitura passa pela RLS, não pela chave secreta.** O front usa a chave pública e a policy `jobs_leitura_autenticada` (migration 0005), que só entrega linha com `ativo = true`. A `sb_secret_…` do coletor ignora RLS e continua só no Actions e no `.env` local — pôr ela no front entregaria o acervo inteiro para qualquer visitante, inclusive as linhas que o portão de local desativou.

**O clique passa por `/ir/[id]`, não por `onClick`.** A métrica que decide o produto é clique em "ver vaga" por usuário por semana, e contador em JavaScript no cliente perde bloqueador, aba aberta no meio do botão e navegação antes do evento subir. Numa rota de servidor, o clique só deixa de ser contado se o servidor não responder — e aí o usuário também não chega na vaga. A URL de destino vem do BANCO, nunca da query string: aceitar destino por parâmetro transformaria isso num redirecionador aberto.

**O estado vazio é coleta de dado, não tela de desculpa.** `buscas` grava uma linha por carga de feed COM a contagem de resultados, então demanda descoberta é `where resultados = 0` e sai da mesma linha que mede quanto o feed entregou. Uma tabela separada só para o vazio discordaria desta na primeira semana. A view `demanda_descoberta` ordena os pares por **pessoas distintas** que pediram — que é exatamente como o custo escala (pares cargo × cidade, não usuários).

**A data é dita com a procedência.** Com `data_publicacao` null em 192 de 192, o cartão escreve "vista em 24/08", não "publicada há 2 dias". A segunda frase seria invenção: com `qdr:w`, item coletado ontem podia ter até sete dias.

**O que a tela ainda NÃO tem:** deploy na Vercel, e SMTP próprio. O remetente padrão do Supabase tem limite baixo de e-mails por hora — serve para um usuário, não para as dez pessoas do Passo 5.

---

## Medições feitas

### Reprodução do Passo 1 pela Serper (22/08, 10 créditos)

87 vagas únicas com os 5 dorks originais, 2 páginas cada — contra 46 medidas à mão. Precisão no dork `pm-bh-job`: ~94% (16 de 17), contando Product Owner como relevante.

### Generalização por cargo (23/08, 94 créditos)

6 cargos × 3 blocos × 2 recortes × 3 páginas, janela de 7 dias, São Paulo + remoto Brasil:

| cargo | jobs | posts | gupy | total |
|---|---|---|---|---|
| Product Manager | 55 ⚠️ | 49 | 9 | 113 |
| Desenvolvedor Front-end | 45 ⚠️ | 16 | 1 | 62 |
| Analista de Dados | 51 ⚠️ | 39 | 7 | 97 |
| Analista de Marketing | 52 ⚠️ | 30 | 18 | 100 |
| Auxiliar Administrativo | 54 ⚠️ | 32 | 25 | 111 |
| Enfermeiro | 47 | 8 | 36 | 91 |

⚠️ saturou o teto do teste (60) — o número real é maior.

**Os dorks generalizam.** Nenhum cargo veio vazio, incluindo não-tech.

**Custo medido:** ~16 créditos por par cargo×cidade, varredura completa dos 3 blocos.

---

## Achados técnicos que mudam a implementação

**1. Snippet da PSE/SERP é contaminado.** A página de uma vaga do LinkedIn traz a barra lateral de "vagas similares" — a frase exata casa no ruído da página, não no cargo. **Extrair da página, nunca do snippet.**

**2. Regex do pré-filtro exige cargo no título, não no corpo.** Confirmado com casos reais: "Global Product **Line** Manager — Screens" (mineração) e "Líder de projetos e pessoas" casaram `"Product Manager"` pela lateral.

**3. No bloco de posts, o pré-filtro por título já está feito pelo `intitle:` do dork.** O campo `title` que a API devolve **não é** o `<title>` da página — o Google reescreve para "Fulano posted this". 8 de 9 títulos genéricos vieram justamente do dork com `intitle:`, ou seja, o cargo **está** no título real. Aplicar regex sobre o `title` da API descartaria vaga boa (falso negativo).

**4. Classe de falso positivo a rotular no harness:** "Líder de Produtos Financeiros", "Especialista de Produto" em varejo, "Especialista II SAP EWM", "Flutter flow Lead PL". Não são PM de tecnologia.

**5. ID de vaga do LinkedIn é proxy de idade,** mas **frágil**: a estimativa por ID errou o volume por uma ordem de grandeza, porque foi feita sobre amostra ordenada por relevância. Só usar com âncoras e sobre conjunto já filtrado por data.

**6. Gupy expõe `Publicada em: DD/MM/AAAA` no snippet — mas em 16% dos casos, e com dois-pontos.** ⚠️ **Corrigido em 25/08.** Ficou escrito aqui que era "o melhor sinal de data estruturado de todas as fontes". É o único sinal real, o que não é a mesma coisa: **9 dos 57 snippets de Gupy em produção têm a data**, os outros 48 não. E os 9 foram todos perdidos, porque a regex exigia `\s+` depois de "em" e a Gupy escreve `Publicada em: 21/08/2026`. Um caractere. Consequência medida: `data_publicacao` null em 197 de 197 linhas de `jobs`.

**7. Duplicação entre blocos confirmada com caso real.** A Omie aparece duas vezes na Gupy e uma como post do agregador "Quero Home", com **URLs diferentes** — a dedup por hash não pega. Dedup semântica é requisito de lançamento.

**Verificado em produção (24/08).** A primeira rodada do classificador colapsou dois posts distintos da mesma vaga da Omie ("Portal Vagas - Product Manager (Cash Management)" e "Vagas Home Office - Product Manager (Cash Management)") na chave `omie|product manager`. A decisão de schema do dia 1 se pagou.

**E falhou na linha seguinte, pelo mesmo motivo que a fez funcionar.** ⚠️ **Diagnóstico corrigido em 25/08.** Ficou escrito aqui que eram "dois posts da mesma vaga do Grupo Boticário". Abrindo as URLs: são `activity:7496187385316208640` (Soluções Corporativas) e `activity:7496202535502934017` (CEx Tech Franqueados) — **duas vagas diferentes**, e duas linhas em `jobs` é o certo. O defeito real é outro e é pior: o LLM truncou um dos cargos e produziu a chave `boticario|product manager`, larga o bastante para engolir em silêncio qualquer outra vaga de PM da empresa. Na reclassificação de 25/08 ele extraiu os dois por inteiro e as chaves saíram corretas — mesma entrada, resultado diferente.

    Vaga Home Office: Product Manager - Especialista I (CEx...  ->  boticario|product manager
    Vaga Home Office: Product Manager Especialista I ...         ->  boticario|product manager especialista i

**A chave de dedup só é tão estável quanto a extração de cargo do modelo.** É exatamente o modo de falha que ela existia para evitar — feed mostrando a mesma vaga duas vezes. Duas saídas possíveis, nenhuma escolhida ainda: normalizar o cargo com mais violência na chave (arrancar sufixo de senioridade/nível), ou aceitar que só a dedup semântica resolve. A segunda já estava marcada como requisito de lançamento.

**8. Entidades HTML vêm com dupla codificação.** Um `&` do texto chega como `&amp;amp;`; as tags de destaque chegam como `&lt;b&gt;`. Duas regras: decodificar `&lt;`/`&gt;` **antes** de remover tags, e passar em `&amp;` **duas vezes**. Já implementado em `normalize/texto.ts`.

**9. Gupy é inversamente correlacionada com tech.** Front-end 1, PM 9, Dados 7 — contra Enfermeiro 36 e Auxiliar Administrativo 25. Não descartar por cargo tech; a fonte serve a outros segmentos.

**10. Sobreposição cidade×remoto é real e varia por cargo.** Front-end teve 15 resultados repetidos entre os dois recortes; PM teve 5. Quanto mais remoto o cargo, mais se paga duas consultas para receber uma vaga.

**11. O mesmo lote classificado duas vezes dá resultado diferente.** Com `temperature: 0`, o dry-run das mesmas 30 linhas aprovou 22 e a rodada real aprovou 21. No harness, duas execuções deram 4 falsos negativos cada — não os mesmos quatro. **Uma rodada não é uma medição.** Antes de citar qualquer número de precisão, rodar três vezes e olhar a variação. E, em produção, isso significa que uma vaga entra ou não no feed por sorteio.

**12. A confiança do modelo não é calibrada.** Das 20 vagas gravadas, 14 vieram com exatamente `0.90`. O limiar de 0,6 quase não discrimina: na prática é binário. Serve para separar "consigo ver a vaga" de "estou chutando" (o balde `confianca_baixa` captura bem os casos sem texto), mas o número **não é probabilidade** e não deve virar ordenação de feed.

**13. Título de vaga do LinkedIn frequentemente não tem a empresa.** 6 das 20 vagas gravadas (30%) ficaram sem empresa identificada, e 5 delas são `linkedin_job` — a fonte onde o prompt diz que o título é confiável. Consequências: o feed mostraria `"não identificada"` como nome de empresa, e essas linhas caem na chave de dedup por id de fonte, então **nunca** deduplicam contra outra fonte. Extrair da página resolveria, ao custo de uma requisição por item.

**14. A tabela "Generalização por cargo" não mede o dork de produção, no bloco de posts.** A medição de 23/08 (`testar-cargos.ts`) usou `"<cargo>"`; a produção (`alvos.ts`) usa `intitle:"<cargo>"`. São dorks diferentes. Os números de post daquela tabela (PM 49, Dados 39, Marketing 30) descrevem o dork SEM `intitle:`. Em produção o bloco de posts entrega cerca de uma ordem de grandeza menos.

**15. O `intitle:` custa ~3x o volume do bloco de posts — medido, não estimado (24/08).** Mesmos 5 cargos, São Paulo, mesma semana, 2 páginas, 20 créditos em cada braço:

| dork | coletados | aprovados pelo classificador |
|---|---|---|
| com `intitle:` (produção) | 19 | 18 |
| sem `intitle:` | 137 | 47 |

Os braços são quase disjuntos: só 12 dos 137 já estavam no banco. **Ganho líquido de 35 vagas aprovadas que o dork de produção não enxerga.** O classificador reprovou 66% do volume extra, ou seja, está segurando o ruído que o `intitle:` segurava antes — que era a pergunta.

**Não decidido, e não dá para decidir com esse número:** aprovação do classificador não é precisão, e tomá-la como prova de acerto é circular. Faltam os 35 rotulados na mão. O bruto está em `posts-sem-intitle-2026-08-24.json` e `scripts/testar-posts-sem-intitle.ts --de=<arquivo>` reclassifica sem gastar crédito.

**Achado colateral, com uma correção minha junto:** eu afirmei que sem `intitle:` entraram vagas de Aracaju/SE e Brasília/DF. Ao rotular os casos um a um, **estava errado**. O de Aracaju é home office — `#aracaju` e `#sergipe` são a localização da EMPRESA, e remoto vale o Brasil inteiro, então a vaga serve. Um terceiro caso que eu tinha citado é uma pessoa com `#opentowork`, nem vaga é. De 137 posts, sobrou **um** caso provável (um quadro de vagas de Brasília) e um ambíguo (Rio). O vazamento existe e é bem menor do que eu disse.

O buraco de fundo continuava real — nada no pipeline olhava local — e foi fechado em 24/08 (achado 17).

**17. O portão de local existe desde 24/08, e o eixo é medido separado do de cargo.** A promessa do produto é presencial/híbrido NA CIDADE + remoto de TODO O BRASIL, e nada no pipeline checava isso. Agora o LLM responde uma terceira pergunta (`localBate`) e há o motivo `local_nao_serve`.

**O rótulo do harness ganhou um eixo, não uma condição a mais.** `rotuloLocal` (`sim` | `nao` | `indeterminado`) é campo separado de `rotulo`. Colapsar os dois jogaria quase todo o golden set em `indeterminado` — a maioria dos títulos não diz o local — e a métrica de cargo, que já tem histórico, deixaria de ser comparável. Hoje: 35 `sim`, 3 `nao`, 86 `indeterminado`.

Resultado no golden set (124 casos): **36 avaliáveis, 35 acertos, 0 fechou errado, 1 deixou passar.** Pegou o quadro de vagas de Brasília e **não** caiu na armadilha de Aracaju — a vaga home office anunciada por empresa de outra cidade foi aprovada, que é o certo.

**Duas armadilhas encontradas ao construir, ambas de medição e não de modelo:**

1. **Reprovação por local contava como falso negativo de cargo.** O recall aparente despencou de 95% para 84% na primeira rodada com o portão ligado, sugerindo que o classificador tinha piorado. Não tinha: era o portão funcionando, contado no eixo errado. `medir()` e `falhas()` agora ignoram `local_nao_serve`; quem mede isso é `medirLocal()`.
2. **A pergunta nova derrubou a confiança de tudo.** O modelo passou a devolver `0.50` com motivo "local não especificado no título" em vaga que ele mesmo dizia ser boa, e 7 vagas caíram por `confianca_baixa`. Foi preciso escrever no prompt que **`confianca` vale só para `ehVaga` e `cargoBate`**, e que silêncio sobre local é o caso normal. Depois disso o eixo de cargo voltou a 100% de precisão e 95% de recall — idêntico ao de antes do portão.

**O que NÃO está medido:** só há 3 casos rotulados como local ruim. "Não deixou passar nada" ainda não é evidência de que o portão pega vaga de outra cidade — é evidência de que quase não foi testado desse lado. O relatório imprime esse aviso sozinho enquanto forem menos de 5.

**16. A hipótese do `#vagas` foi testada e não se sustenta (24/08).** Observação do Pedro olhando posts na mão: todo post de vaga carrega `#vagas` e uma hashtag do cargo. Medido de dois jeitos independentes, os dois negativos.

*Pela SERP* (`scripts/testar-posts-hashtag.ts`, 14 créditos): o Google **honra** o `#` — a sonda `"#vagas"` contra `"vagas"` devolveu 10 resultados cada com 0% de sobreposição, então a estratégia é expressável. Mas como filtro rende ~2,5 itens por consulta com 38% de aprovação: mais estreito que o dork sem `intitle:` e muito menos preciso que o com. A variante só-hashtags (`#vagas` + `#frontend`) rendeu 17% — sem o cargo por extenso a consulta perde a âncora.

*Abrindo os 137 posts* (`scripts/medir-hashtag-nos-posts.ts`, zero crédito):

| grupo | posts | com `#vagas` | com alguma hashtag |
|---|---|---|---|
| todos | 137 | 28 (20%) | 85 (62%) |
| aprovados pelo LLM | 46 | 11 (24%) | 26 (57%) |
| reprovados pelo LLM | 91 | 17 (19%) | 59 (65%) |

**Três quartos dos posts de vaga não têm `#vagas`, e a hashtag não separa vaga de não-vaga** — 24% contra 19% é ruído. Ter hashtag qualquer é até levemente mais comum no que foi reprovado. Não existe tag dominante na cauda (`#homeoffice` 5, `#carreira` 5, `#oportunidade` 5, e lixo como `#sabdou`/`#sextou`), então um dork por hashtag precisaria de um `OR` longo e ainda perderia os 38% sem hashtag nenhuma.

Isso também explica o resultado da SERP: o dork de hashtag veio estreito porque a hashtag não está lá, não porque o Google não a indexa.

**Nota de método:** a página pública do post abre sem authwall em GET anônimo — os 137 baixaram. Isso NÃO é a exceção da restrição 2 do CLAUDE.md, que trata de scraping autenticado (DOM logado, sessão, endpoint interno) e continua valendo. É medição pontual, sem cookie e sem conta envolvida. Transformar isso em coleta de produção é decisão à parte, não tomada.


**18. O portão de local nunca rodou em produção — e dá para provar pelo relógio (25/08).** Zero linhas de `raw_results` com motivo `local_nao_serve`. As duas rodadas de produção foram em 24/08 às 14:33; o commit que criou o portão é de 24/08 às 17:23. As 197 linhas de `jobs` são todas anteriores a ele.

O resultado está no banco e apareceria na primeira tela do feed:

| empresa | cargo | modelo | localização |
|---|---|---|---|
| Schreiber Foods | Digital Product Manager | híbrido | Green Bay, Wisconsin |
| — | Senior Product Manager | remoto | France |
| BairesDev | ServiceNow Product Manager | remoto | Federal District, Venezuela |

O achado 17 continua válido como medição do portão sobre o golden set. O que ele não diz, e passou a parecer que dizia, é que o portão tenha julgado alguma vaga de produção. Não julgou nenhuma. `jobs.local_avaliado` existe desde a migration 0004 para essa diferença nunca mais ficar implícita.

**19. `tbs=qdr:w` não garante vaga de até 7 dias.** Dos 202 snippets de `linkedin_job`, 33 trazem um "Há X dias/semanas/meses" ancorado no próprio título da vaga (o título aparece ANTES da expressão, e não é a barra lateral). Distribuição desses 33: 8 com menos de 1 dia, 16 entre 1 e 7 dias, **8 entre 8 e 30 dias, 1 acima de 30**.

Ou seja: pelo menos 27% do que o filtro de data devolveu já tinha mais de uma semana. Duas explicações possíveis e não separáveis sem verdade de campo — a âncora pode estar errada, ou o `qdr:w` filtra a data do ÍNDICE e não a da publicação. As duas são ruins do mesmo jeito para a promessa central.

**Não vale como fonte de `data_publicacao`.** O sinal existe em 16% das linhas do LinkedIn e erra em pelo menos um quarto delas. Foi medido e descartado, não implementado.

**20. O modelo de trabalho não está no título. Em nenhum.** Regra determinística de leitura de "home office", "100% remoto", "híbrido" e "presencial", rodada sobre as 114 linhas em que o LLM não respondeu `modelo`: **recuperou 0**.

| fonte | sem modelo | o título daria | o snippet daria |
|---|---|---|---|
| linkedin_job | 89 | 0 | 17 |
| ats_gupy | 22 | 0 | 0 |
| linkedin_post | 3 | 0 | 0 |

Os 17 que o snippet resolveria são todos `linkedin_job`, onde o snippet é a barra lateral (achado 1) — ler dali gravaria o modelo de OUTRA vaga. Os títulos que carregam o termo são exatamente aqueles que o LLM já tinha rotulado, então não sobra nada.

A regra ficou no código (`modeloDoTexto`, seis linhas, e dispara em coleta com mais posts), mas **não conserta os 58% sem modelo**. Só a página conserta — a mesma conta de uma requisição por item que trava a extração de empresa e a solução dos posts.

**21. Vinte e cinco grafias de São Paulo colapsam em uma.** `normalizarLocal` sobre as 197 linhas: 132 ganham cidade identificada, e **103 delas viram `sao-paulo`** — vindas de `São Paulo, SP`, `São Paulo`, `São Paulo - SP`, `São Paulo/SP`, `São Paulo, Brasil`, `São Paulo e Região`, `Vila Mariana – São Paulo/SP` e mais. País confirmado Brasil em 139, desconhecido em 52, confirmado fora em 6.

A regra que desambigua cidade de estado homônimo não é gazetteer, é gramática de endereço: **quando a sigla da UF está escrita, ela já ocupa o papel de estado**, então `São Paulo` em `Vila Mariana – São Paulo/SP` só pode ser a cidade. Sem sigla, em `Osasco, São Paulo`, quem faz papel de estado é o nome por extenso e a cidade é Osasco. Mesma forma, papéis diferentes.


**22. O portão de local, medido dos DOIS lados em produção (25/08).** As 278 linhas foram reclassificadas com o portão ligado. Resultado: **9 reprovas por `local_nao_serve`**, contra zero antes (achado 18). Abrindo uma a uma:

| # | vaga | local real | veredito |
|---|---|---|---|
| 1 | BairesDev — ServiceNow PM | Federal District, Venezuela | ✅ certo |
| 2 | Schreiber Foods — Digital PM | Green Bay, Wisconsin (híbrido) | ✅ certo |
| 3 | Senior PM, Remote Build | Remote France | ✅ certo |
| 4 | Pennylane — Product Designer | Germany / Lisboa, Portugal | ✅ certo |
| 5 | JIXAAR AI — Sr Product Designer | Uganda | ✅ certo |
| 6 | Jobgether — Sr Product Designer | Canada | ✅ certo |
| 7 | Walsywa — Analista de Mkt Digital | Jundiaí, SP (busca: São Paulo) | ✅ certo |
| 8 | Supermix Concreto — Aux. Admin. | Piracicaba, SP (busca: São Paulo) | ✅ certo |
| 9 | Grupo LSL — Aux. Admin. Fiscal | **São Bernardo do Campo** (busca: São Paulo) | ❌ errado |

**8 de 9 corretas.** A nona é falso positivo: São Bernardo do Campo é região metropolitana de São Paulo, e o próprio prompt manda contar região metropolitana.

**E o erro não é do prompt: é de consistência dentro da MESMA rodada.** Havia três linhas de São Bernardo do Campo, todas da busca `Auxiliar Administrativo / São Paulo`. **Duas foram aprovadas e uma reprovada.** Não há dado que separe as três — é achado 11 aparecendo no eixo de local.

Isso tira a pendência "o portão está medido só de um lado" e põe outra no lugar, mais específica: **pertencer à região metropolitana é julgamento que o LLM faz de forma instável.** Existe saída determinística — `cidade_slug` já está gravado, e uma tabela de municípios por região metropolitana é conjunto fechado, como as 27 UFs. Não foi feita.

**23. Reclassificar o mesmo acervo move números que não deveriam se mover.** Mesmas 278 linhas, mesmo prompt, mesmo modelo, `temperature: 0`:

| | rodada de 24/08 | rodada de 25/08 |
|---|---|---|
| pré-filtro (determinístico) | 63 | **63** |
| `cargo_de_outra_familia` | 7 | 7 |
| `nao_e_vaga` | 7 | **2** |
| `confianca_baixa` | 0 | **2** |
| `local_nao_serve` | — | 9 |
| aprovadas | 201 | 195 |

O pré-filtro bateu exatamente, que é o controle: o que é determinístico não se move. Tudo que se moveu passou pelo modelo. `nao_e_vaga` caindo de 7 para 2 sem uma linha de código mudar é a medida honesta do ruído — **cinco vagas entram ou não no feed por sorteio**. Achado 11 continua sendo o achado mais caro deste projeto.


**24. A API pública do portal da Gupy responde qualquer cargo, de graça, e resolve três dos quatro buracos de dado (26/08).** Endpoint que o próprio portal chama, sem chave e sem autenticação: `employability-portal.gupy.io/api/v1/jobs?jobName=…&city=…&workplaceType=remote`.

Comparação sobre dado real, do mesmo dia:

| campo | pela SERP (192 linhas) | pela API (76 linhas) |
|---|---|---|
| `data_publicacao` real | **0%** | **100%** (timestamp com hora) |
| `modelo` de trabalho | 47% | **100%** |
| empresa identificada | 72% | **100%** |
| cidade e UF | parcial | **100%** |

**Consequência que muda o desenho: esta camada não precisa de LLM.** As três perguntas do classificador viram — é vaga por construção (anúncio de ATS), `cargoBateNoTitulo` (determinístico, já medido) e comparação de campo estruturado. Zero crédito, zero cota, resposta em segundos. `Vendedor / São Paulo` foi de 1 para 77 vagas em dois segundos.

**Volume dentro da janela de 7 dias**, e é o achado 9 confirmado com números: Enfermeiro 100+, Auxiliar Administrativo 100+, Marketing 61, Dados 41, **Product Manager 10, Front-end 3**. Ela cobre o que a SERP cobria mal e não substitui a SERP no que esta cobre bem. `Product Manager / Belo Horizonte` devolveu **1 vaga, vencida** — em cidade menor e cargo tech ela é magra.

**Três limites que precisam ficar escritos:**

1. **A fonte única de ATS virou fonte carregada.** Já era pendência registrada; agora sustenta o caso de cargo novo.
2. **A API não é documentada.** É pública, anônima e sobre dado público — a mesma categoria de "ATSs brasileiros públicos" que a restrição 3 autoriza, e sem relação com a restrição 2, que trata do LinkedIn AUTENTICADO. Ainda assim pode mudar sem aviso: tudo degrada para lista vazia, e há teste para isso.
3. **A fonte se contradiz.** Vaga com `city: São Paulo` e título dizendo Gravataí; `careerPageName` com texto de marketing (`🚀 A seleção já está rol`) no lugar do nome da empresa.

**Uma distinção que só apareceu ao escrever teste:** fonte caída não é fonte vazia. A primeira versão engolia falha de rede e devolvia lista vazia, o que carimbaria o frescor e suprimiria a próxima tentativa por 30 minutos por causa de um soluço.

**25. `buscas` gravava o dobro — e é a tabela que mede o produto (26/08).** Toda carga de feed gerava duas linhas. Causa: a escrita acontecia durante a renderização de um Server Component, e render repete (documento mais payload de RSC, prefetch, re-render em dev). Sintoma: toda métrica de busca inflada em 2×, incluindo a contagem de pedidos da fila de priorização.

Corrigido com uma janela de 60 segundos — busca repetida pelo mesmo usuário dentro de um minuto não grava linha nova, o que também é a leitura honesta do comportamento. **Escrita durante render é o anti-padrão; a janela é o remendo.** Se um dia a telemetria precisar ser exata, ela sai do render.

**26. A fila de demanda nascia fragmentada por gênero gramatical (26/08).** No primeiro uso real, o Pedro digitou "Enfermagem", "Enfermeira" e "Enfermeiro" na mesma sessão. A `demanda_descoberta` agrupava por texto cru e mostrou **três linhas com uma pessoa cada** — uma necessidade virando três sinais fracos, numa fila que decide onde gastar crédito da Serper.

`chaveDeFamilia` agrupa por sufixo (`-eira`→`-eiro`, `-ora`→`-or`, `-aria`→`-ario`, `-ica`→`-ico`), **não** por `-a`→`-o`, que estragaria "analista", "motorista" e "dentista". Depois do backfill: 3 linhas viraram 2, com `enfermeiro|` agregando `enfermeira, enfermeiro`.

O que ela deliberadamente NÃO resolve, e está em teste para não virar surpresa: **"enfermagem" continua separado de "enfermeiro"**. São derivações diferentes — a área e a profissão — e colapsá-las exigiria léxico, que é o que o CLAUDE.md proíbe para regra de cargo. A view guarda a coluna `termos` com o que o usuário escreveu de fato, justamente para esse tipo de caso ficar visível.


**27. A SERP não enxerga o post no dia em que ele é publicado — e isso bate no diferencial do produto (26/08).** O Pedro buscou "Senior UX Designer", recebeu vazio, e tinha aberto na tela um post de recrutador do mesmo dia anunciando exatamente essa vaga. Rodamos a Serper nesse cargo (11 créditos) para descobrir por quê.

O bloco de posts devolveu **1 item em 37 coletados**, e não era o dele. Duas sondas separaram a causa:

| sonda | resultado |
|---|---|
| a frase exata do post, **sem nenhuma restrição** | **0 resultados** |
| `site:linkedin.com/posts "Senior UX Designer"` com `qdr:w` | 10 resultados |

**O Google não tinha o post.** Ele tinha 5 horas. O dork funciona e há volume; o que falta é o índice.

Isso não é um problema de dork, e nenhum ajuste de `intitle:` resolve. O CLAUDE.md abre dizendo que o diferencial é capturar post de recrutador; post de vaga tem meia-vida de horas; e a única via para posts é a SERP. **Se a indexação demora mais que a meia-vida do anúncio, o produto chega estruturalmente atrasado na fonte que o diferencia.**

É UM caso, não uma medição — mas é o primeiro teste do bloco de posts num anúncio verificável à mão, e o resultado é negativo. Fechar a conta custa 1 crédito: repetir a sonda da frase exata dias depois e ver quando (ou se) ela aparece.

Achado colateral: dos 10 resultados do dork de posts, a maioria é em inglês e de fora do Brasil. O bloco traz ruído internacional mesmo quando funciona.

**28. Reclassificar rejuvenescia o acervo inteiro, em silêncio (26/08).** `paraLinhaJob` não gravava `data_coleta`, então o Postgres aplicava `default now()`. Como a reclassificação apaga e reinsere `jobs`, todas as linhas da SERP ficaram carimbadas com a hora da reclassificação:

    jobs.data_coleta        2026-08-26T00:14   <- momento da reclassificação
    raw_results.data_coleta 2026-08-24T17:47   <- a verdade

Três estragos, e o terceiro é o pior. O cartão exibia "vista em 26/08" para algo visto em 24/08. As linhas da SERP passaram a rankear como a coisa mais fresca do banco e enterravam as vagas da Gupy, que têm data de publicação real — em Auxiliar Administrativo havia 11 vagas da Gupy e as 10 primeiras da lista eram todas LinkedIn. E, sobretudo, **`data_referencia` é o predicado da janela de 7 dias**: vaga de 24/08 passava a sobreviver até 02/09, e cada nova reclassificação estenderia de novo.

`data_coleta` agora é herdada de `raw_results`. Backfill corrigiu 275 linhas.

**29. Senioridade no termo estreita a busca na ORIGEM (26/08).** A API da Gupy casa por substring, e o casamento de família já ignora senioridade de propósito — mas o termo ia cru para a fonte:

| busca | antes | depois |
|---|---|---|
| Senior UX Designer, remoto | 0 | 1 |
| Senior UX Designer, São Paulo | 0 | 2 |
| Analista de Dados Sênior, SP | 2 | **19** |

O ganho maior não veio da senioridade: veio de um bug que o teste pegou DENTRO da correção. A primeira versão usava `tokenizar`, que aplica as variantes lexicais (`dados`→`data`) — então a consulta virava "analista de data" e perdia todas as vagas escritas "Analista de Dados". `semSenioridade` opera sobre a grafia original, e existe teste dizendo por quê.

**30. A busca ficou escondida no rodapé, dentro de um `<details>` fechado (26/08).** Num produto cuja premissa é "o usuário informa cargo e cidade", o formulário estava depois da lista inteira de vagas, colapsado, com o rótulo "Mudar cargo ou cidade". O Pedro reportou como "ainda não consigo pesquisar por qualquer vaga" — e não era o dado, que já funcionava: era que não havia onde pesquisar. Subiu para o topo, em caixa própria, sempre aberta.

**31. Código que finge funcionar é pior que código ausente (26/08).** A memória de busca da sessão gravava cookie durante a renderização de um Server Component. O Next só permite isso em Server Action ou Route Handler, e o `try/catch` engolia o erro — o cookie nunca foi gravado e nada acusou. A escrita passou para a ação de buscar; o feed só lê. A garantia de não repetir consulta sempre foi da camada de banco (`coletas_sob_demanda`), que é a que vale para todos os usuários.

**32. Nenhuma solução paga resolve a descoberta de post do LinkedIn — e o vendedor escreve isso na própria documentação (27/08).** Pesquisa de mercado motivada pelo achado 27, com a pergunta explícita "existe alternativa, paga que seja, que faça o diferencial funcionar?". Resposta: não.

O Apify vende um *LinkedIn Keyword Posts Monitor*, que é exatamente o produto procurado. A documentação dele diz:

> *"LinkedIn does not expose a no-auth post-search endpoint, so discovery runs through Google, with coverage depending on Google's index for linkedin.com/posts."*

Descoberta por `site:linkedin.com/posts "<keyword>"`. **É o nosso dork.** Pagar por essa camada é terceirizar a consulta que já fazemos na Serper, herdando a mesma latência de indexação.

| opção | o que entrega | resolve frescor? |
|---|---|---|
| Apify Post Monitor | descoberta via Google + fetch da página | ❌ mesmo índice, mesma latência |
| Bright Data — dataset | 119M registros, ~$250/100K | ❌ é fotografia, não feed; `last_updated` de semanas a meses |
| Bright Data — on-demand | coleta fresca no momento do pedido | ❌ exige a URL; a descoberta volta ao Google |
| curl_cffi + proxy residencial | evasão de TLS/HTTP2 fingerprint | ❌ resolve o fetch, não a descoberta |
| Voyager / cookie `li_at` | busca nativa de posts, tempo real | ✅ **e é o que a restrição 2 proíbe** |

**A distinção que organiza a tabela inteira: baixar a página e saber que a página existe são problemas diferentes. Todo produto pago resolve o primeiro. O nosso é o segundo.** Só o caminho autenticado tem ✅, e tem porque o LinkedIn só expõe busca de post para quem está logado.

**O que dinheiro compra de verdade:** contas descartáveis com proxy rotativo, ~$300–800/mês. É literalmente o que matou a hiQ — o summary judgment de nov/2022 cita *"hiring of crowdsourced workers to create fake profiles"*, e o desfecho foi US$ 500 mil, injunção permanente e destruição de todo o código e dado. O preço dessa opção não é mensal, é a existência do produto. **A restrição 2 não é conservadorismo: é a leitura correta do único caso julgado.**

**33. O diferencial declarado confunde o meio com o fim, e existe candidato melhor no eixo que importa (27/08).** O CLAUDE.md abre dizendo que o diferencial é "post de recrutador que anuncia oportunidade apenas em texto". LinkedIn é onde assumimos que esse texto mora — não é o diferencial em si.

**Telegram é a hipótese não testada mais barata que existe hoje**, e ataca exatamente o eixo onde a SERP falha:

- **Latência de segundos.** É push, não índice. O problema do achado 27 desaparece por construção.
- **MTProto é API oficial e documentada.** Não é engenharia reversa, não é DOM logado, não é endpoint interno — categoria diferente da restrição 2, que trata do LinkedIn autenticado.
- **`t.me/s/<canal>` é HTML público, sem login, sem chave, sem conta.** Dá para medir cobertura numa tarde a custo zero.
- Grátis, e o formato nativo do canal é justamente o texto informal.

**O risco que precisa ser medido ANTES de qualquer código:** boa parte desses canais é agregador que republica vaga de portal. Se for o caso, trocamos uma fonte magra por uma redundante com a Gupy e não ganhamos nada. A pergunta mensurável é **qual fração das mensagens de um canal é vaga que não está em nenhum ATS** — dez canais, uma tarde, zero real.

Isso é hipótese registrada, não decisão tomada. Nada foi implementado.

**34. O parecer sobre o PDF "Indexador de Vagas do LinkedIn" (27/08) — descartado, com uma pendência preservada.** Documento externo propondo arquitetura completa (Voyager, curl_cffi, Apify, Instructor/Pydantic, Meilisearch). Veredito: descartar a arquitetura.

- **Propõe o que a restrição 2 proíbe** (cookie `li_at`), e descarta pelo argumento errado — fragilidade operacional, não ToS.
- **Ignora a restrição 1 inteira.** Proxy residencial, Apify, CapSolver, servidor de Meilisearch. Nenhuma alternativa gratuita ao lado de nenhuma.
- **Meilisearch é otimização prematura por três ordens de grandeza.** Argumenta contra o Postgres com problemas de escala que não temos: são 192 linhas em `jobs`. Faceting lento não é o gargalo; `data_publicacao` null em 192 de 192 é. E `distinctAttribute` não conserta dedup — a nossa falha vem da extração instável de cargo pelo LLM (achado 11), e trocar de banco só move dado sujo de lugar.
- **Instructor/Pydantic já existe em `src/classificar/`**: JSON estrito, retry, pré-filtro barato antes da inferência cara. Descrito como novidade.
- **Referências não confiáveis.** A ref. 44, única fonte da seção jurídica inteira, é um diagnóstico do CNJ sobre devolução de crianças e adolescentes. Nada a ver. E a seção sobre hiQ usa só a metade favorável do caso, omitindo que a hiQ perdeu por quebra de contrato e foi liquidada.

**O que sobreviveu:** o documento articula bem a latência de rastreio ("horas a várias semanas"), que é o achado 27 dito por terceiro. Não é confirmação independente — não traz número nem método, e erra citação. **A sonda de 1 crédito continua sendo a única forma de fechar essa conta.**

**35. O Telegram foi medido, e a resposta não é "eco" nem "diferencial" — é uma terceira coisa (29/08).** 10 canais, 739 mensagens na janela de 7 dias, custo zero. `scripts/testar-telegram.ts`, classificação em `src/fontes/telegram.ts` com teste.

| balde | msgs | % | o que é |
|---|---|---|---|
| `bot_agregador` | 299 | 40,5% | robô republicando vaga do LinkedIn |
| `portal` | 278 | 37,6% | link para quadro de vagas ou ATS |
| **`informal_com_cargo`** | **80** | **10,8%** | **anúncio que só existe na mensagem, com cargo** |
| `so_imagem` | 39 | 5,3% | vaga dentro de panfleto, ilegível sem OCR |
| `informal_sem_cargo` | 26 | 3,5% | "vagas abertas no Shopping Boulevard" |
| `spam_curso` | 17 | 2,3% | venda de curso usando vocabulário de emprego |

**O texto informal existe e é real.** 72 das 80 trazem contato direto (WhatsApp, telefone ou e-mail), com empresa e requisitos no corpo: "🍽️ Atendente — Restaurante Sabor a Mi", "Contrata-se Redator(a) de Conteúdo em BH". Fluxo estável de ~15/dia. É exatamente o que o cabeçalho deste documento promete e que a SERP não entrega.

**E não é eco da Gupy.** Das 75 avaliadas (de 80; 1 sem cargo extraível, 4 com a Gupy recusando a consulta), a Gupy tem o mesmo cargo na mesma cidade em 60 (80%) — mas isso é o **limite superior** do eco, porque é família de cargo, não a mesma vaga. Na conferência por empresa, a sobreposição é **zero**: a Gupy em Manaus/BH devolve RD Saúde, Coca-Cola, Assaí, Bemol, hospitais; o Telegram informal devolve Restaurante Sabor a Mi, Selva Pet, Dunorte Pescados, garçom na Savassi. Pequeno negócio local não está em ATS. São universos disjuntos.

**Achado colateral sobre a fonte carregada:** a API da Gupy **recusa consulta sob rajada**. Numa das rodadas, 13 de 79 chamadas sequenciais falharam; noutra, 4. O código já trata (`falhou` separado de "vazio"), mas o relatório não contava as falhas e o denominador encolhia em silêncio — a mesma classe de erro do achado 24, agora na medição em vez de na coleta. Corrigido. **Consequência para a trava 10:** a fonte que sustenta o caso de cargo novo sozinha tem limite de taxa não documentado.

**Frescor confirmado na prática:** mensagem mais nova com 41 minutos no momento da leitura, e `t.me/s/` pagina para trás — ou seja, **entrega fluxo E acervo**, o que o Google Alerts nunca deu. O problema do achado 27 não aparece aqui.

**AGORA A PARTE QUE ESTREITA A HIPÓTESE, e ela é grande.**

1. **O diferencial mora em 2 canais de 10.** 70 das 80 informais vêm de `empregosmanausamoficial` e 10 de `empregosbh`. Os outros oito entregam zero. A fonte não é "o Telegram": são dois canais.
2. **Os canais de tech são 100% robô.** `vagasfront` e `vagasbackend` somam 299 mensagens, e 233+66 são o mesmo molde "🚨Nova vaga encontrada🚨 ... verificada por IA", com 242 citando o LinkedIn na própria mensagem. **Para o perfil que o produto atende hoje — tech, São Paulo — o Telegram não traz nada que já não coletemos.** Ele serve não-tech local.
3. **`rjempregos` é 240 de 240 republicação do portal próprio.** Canal grande, 9,4K inscritos, zero valor marginal.
4. **Descobrir CANAL é o mesmo problema de descobrir post, um nível acima.** Não há busca pública de canais sem conta; a lista saiu de busca na web e metade estava morta ou era grupo (`t.me/s/` só abre canal). **É a mesma forma do limite do Google Alerts: funciona bem para conjunto fixo e curado, e não escala para cargo × cidade arbitrários,** que é a promessa do produto.
5. **Viés da amostra, e ele corta contra o resultado bom:** canal achado por SEO tende a ser agregador. Canal pequeno de recrutador é sub-representado, então 10,8% é piso, não estimativa.

**Erro de medição que quase inverteu a conclusão, e por isso virou teste.** A primeira rodada devolveu 47,3% de "só texto" — quatro vezes o número real. Causa: a regra de link de contato casava `whatsapp` como substring da URL, e as vagas do `rjempregos` têm slug terminado em `-whatsapp`. 240 republicações de portal entraram como anúncio informal. **O erro caiu a favor da hipótese que o teste existia para julgar**, que é o pior lado possível. Contato agora é casado por host, e o caso do slug está em `test/telegram.test.ts`.

**36. ATS por empresa: Greenhouse vale, Lever e Ashby quase não (19/10).** APIs oficiais, públicas, sem chave: `boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`, `api.lever.co/v0/postings/{slug}?mode=json`, `api.ashbyhq.com/posting-api/job-board/{slug}`. `scripts/sondar-ats.ts`, 70 slugs chutados de empresas brasileiras, zero custo. Bruto em `sondar-ats-2026-10-19.json`.

| plataforma | slugs vivos | vagas no Brasil | com data | descrição completa | em 7 dias |
|---|---|---|---|---|---|
| Greenhouse | 16 | 1.243 | 100% | 100% | 114 |
| Ashby | 2 (Nubank está aqui) | 31 | 100% | 100% | 10 |
| Lever | 3 | 19 | 100% | 100% | 1 |

Maiores no Greenhouse: Stone 343, BTG 259, C6 156, Inter 154, XP 120, QuintoAndar 89.

- **Resolve o que a SERP nunca resolveu:** data, empresa e descrição em 100%. É o dado que o currículo adaptado exige.
- **É acervo, não fluxo:** só 9% caiu na janela de 7 dias.
- **Segmento estreito:** fintech/tech de SP. Complementa a Gupy, que é magra em tech (achado 9).
- **Descoberta de slug é manual.** Escala com uma busca `site:boards.greenhouse.io` pela Serper, uma vez só.
- **O filtro de Brasil da sonda é grosseiro:** Arco aparece com 424 vagas e 0 no Brasil, quase certamente a regex falhando no formato de local. Os números de Brasil são piso.
- **Não medido:** sobreposição com `jobs` (trava 10). Consultorias e fintechs também anunciam no LinkedIn Jobs.

**37. Dez portais brasileiros sondados — três servem (19/10).** Critério: vaga pública sem login, robots.txt permitindo, e JSON-LD `JobPosting` na página da vaga (data + empresa + descrição).

| site | veredito |
|---|---|
| **InfoJobs** | ✅ portal generalista, busca por cargo×cidade na URL, `datePosted` com hora |
| **Michael Page** | ✅ consultoria, `/job-detail/` liberado, `JobPosting` completo |
| **Robert Half** | ✅ consultoria, sem robots.txt, `JobPosting` completo |
| Hays | ❌ robots.txt proíbe `/Job/Detail/*` |
| Catho | ❌ 403 anti-bot |
| Solides | ⏸️ SPA, uma empresa por subdomínio; API do front não encontrada |
| GeekHunter, Revelo | ❌ marketplace de talentos — a empresa procura o candidato, sem vaga pública |
| Talenses, Produtive | ❌ sem vaga no HTML |
| Recrutei, Abler, Pandapé | ❌ API exige token da empresa, plano pago ou não existe |

**A lista mistura dois tipos de coisa:** portal de vaga e banco de currículo. Só o primeiro é indexável.

⚠️ **InfoJobs, Michael Page e Robert Half são scraping de HTML, não API.** A restrição 3 autoriza "ATSs brasileiros públicos" e agregadores com API aberta; portal brasileiro não está lá. ~~Adotar qualquer um dos três é decisão de ampliar a restrição 3, não tomada.~~ **Tomada em 20/10: restrição 3 ampliada, InfoJobs adotado.** E quebra quando o site mudar o layout.

**Volume do InfoJobs, 1ª rodada — PISO, não medida.** A paginação estava errada (o parâmetro é `Page` maiúsculo, no fim da URL; `page` minúsculo é ignorado em silêncio) e só a 1ª página foi lida:

| cargo × cidade | lidas | em 7 dias |
|---|---|---|
| Auxiliar Administrativo, SP | 20 | 20 |
| Analista de Dados, SP | 20 | 17 |
| Enfermeiro, SP | 20 | 17 |
| Vendedor, BH | 20 | 13 |
| Product Manager, SP / BH | 9 / 6 | 1 / 1 |
| Front-end, SP | 7 | 0 |

Não-tech: a 1ª página inteira está na janela, então o volume real é maior. Tech/produto: o InfoJobs não serve. **Greenhouse (tech) e InfoJobs (não-tech) se complementam.** 15–30% das páginas vieram sem `datePosted` legível — não separei ausência de dado de falha do parser.

**Rodada completa, janela de 7 dias inteira (20/10).** `scripts/medir-infojobs.ts` → `infojobs-2026-10-20.json`; filtro de família em `scripts/infojobs-familia.ts`, sem requisição nova. A 1ª rodada acima ficou como registro do erro de paginação.

| cargo × cidade | InfoJobs bruto | InfoJobs na família | Gupy na família | mesma empresa | mesma vaga |
|---|---|---|---|---|---|
| Auxiliar Administrativo, SP | 267 | **94** | 20 | 2 | 1 |
| Analista de Dados, SP | 123 | **4** | 15 | 0 | 0 |
| Enfermeiro, SP | 22 | **14** | 25 | 0 | 0 |
| Vendedor, BH | 73 | **42** | 26 | 0 | 0 |
| Product Manager, SP | 1 | **1** | 6 | 0 | 0 |

- **Não é eco da Gupy.** Uma vaga em comum em 486. Universos quase disjuntos: Gupy é empresa média/grande com ATS; InfoJobs é anúncio direto e agência de RH. Mesmo padrão do achado 35, por outra fonte.
- **A busca do InfoJobs é frouxa, e o bruto engana por uma ordem de grandeza.** "Analista de dados" devolveu 123 e só 4 são da família — o resto é Analista Fiscal, de Suporte, Contábil. **O ganho real está em Auxiliar Administrativo (94 contra 20) e Vendedor (42 contra 26).** Em Dados e Enfermeiro a Gupy entrega mais.
- **O filtro pode estar cortando vaga boa:** "Consultor de Vendas" saiu da família de Vendedor. É recall do `familia.ts` aparecendo numa fonte nova — não medido.
- **Mesma empresa depende do nome bater.** "Empresa confidencial" e agência não casam com nada, o que subestima a sobreposição. Não explica um zero tão consistente.
- **Vendedor BH: 57 de 156 páginas sem `datePosted` legível (37%).** Não separei ausência de dado de falha do parser.

**Quadro de fontes que sai disso:** não-tech = Gupy + InfoJobs (se complementam); tech/fintech = Greenhouse; LinkedIn Jobs = descoberta, com descrição instável (achado 38).

**38. Revalidação das premissas, 20/10 — a Gupy estava quebrada em silêncio.** Primeira checagem depois de sete semanas parado.

| peça | estado |
|---|---|
| **API da Gupy** | ❌ → ✅ `employability-portal.gupy.io/api/v1/jobs` passou a devolver **404**. O portal agora chama `portal.gupy.io/api/job-search/jobs`, mesmo payload. Trocada uma linha em `src/fontes/gupy.ts`; 240 testes passam |
| Serper + dork de produção `linkedin_job` com `qdr:w` | ✅ 10 vagas reais, 1 crédito |
| `gemini-3.5-flash-lite` | ✅ 200 |
| Supabase | ✅ despausado; `jobs` com 294 linhas (121 Gupy, 155 LinkedIn Jobs, 18 posts) |
| build do `web/` | ✅ |
| página pública da vaga do LinkedIn (trava 4) | ⚠️ **instável** |

**A falha da Gupy é o achado 24 cumprido.** "Pode mudar sem aviso: tudo degrada para lista vazia." Degradou — e o tratamento de "fonte caída" fez o que devia, que é não quebrar nada e não avisar ninguém. **Cargo novo teria recebido feed vazio, indistinguível de "não há vaga".** Falta um teste de saúde das fontes que rode sozinho e grite.

**Trava 4 sob suspeita.** Oito GETs anônimos em `linkedin.com/jobs/view`, espaçados de 8s: **1** entregou `JobPosting` completo (data com hora, empresa, descrição de ~1.900 caracteres), **5** voltaram 200 numa variante SEM o `JobPosting`, **2** voltaram 429. A página tem o dado; o LinkedIn raciona e varia a resposta ao visitante anônimo. **Para o currículo adaptado, a descrição do LinkedIn Jobs não está garantida.** Saídas: tratá-lo como fonte de descoberta (título + link), ou medir ritmo e retentativa antes de decidir. Login e cookie continuam fora (restrição 2).

**Greenhouse × `jobs`:** das 294 linhas, só 2 são de empresas que estão no Greenhouse (Stone e RD Station, ambas via LinkedIn Jobs), e nenhuma das duas vagas existe hoje lá. Aponta para empresas novas, não eco — conta fraca: `jobs` é de agosto, de 6 cargos, e 28% do LinkedIn sem empresa.

**39. As vagas "em Todo Brasil" do InfoJobs: metade é remota de verdade, e a outra metade não tem cidade (22/10).** Elas não trazem `JobPosting` — o InfoJobs omite o bloco quando a vaga não tem endereço —, e o coletor as descartava todas: 55 de 147 páginas em Vendedor/BH.

Amostra de 21, de 8 buscas, lendo o campo de modelo da própria vaga:

| modelo | vagas | destino |
|---|---|---|
| Home office | 12 | ✅ remoto do Brasil, entra em qualquer feed |
| Presencial | 8 | ❌ "Operador de Loja Carrefour - Uberlândia": cidade só no título, sem feed onde caber |
| selo PCD lido como modelo | 1 | erro de parser, corrigido — o modelo sai do ÍCONE (`#user-home`, `#buildings`), não do primeiro campo do estilo |

- **"Todo Brasil" não é sinônimo de remoto.** Só o campo de modelo separa.
- **A qualidade das remotas surpreendeu para cima.** Só 3 de 12 eram comissão pura, todas da mesma empresa. **7 de 12 eram tech** (Back-End, Front-end Sênior, Full Stack, QA, SEO) — o InfoJobs quase não tem tech na busca por cidade, mas tem no balde remoto, que é justamente onde o produto é mais fraco.
- **Tipo de contrato vem em 21 de 21** ("Efetivo – CLT", "Prestador de Serviços (PJ)"). Virou `jobs.tipo_contrato` (migration 0009) e etiqueta no cartão — a pessoa vê "PJ" antes de clicar, em vez de o parser decidir o que é vaga de verdade.
- **Data sem ano nem hora** ("Hoje", "Ontem", "20 out"). Ano inferido para trás quando cairia no futuro; meio-dia de Brasília.

**Em produção, coleta seca de 22/10:** Vendedor/BH foi de **36 para 65** aproveitadas — 34 remotas lidas do bloco, 13 presenciais "Todo Brasil" contadas e descartadas, `semJobPosting` de 55 para 1. Desenvolvedor/SP: 2 remotas em 7.

**O que fica de olho:** 34 remotas de Vendedor entram no feed de Vendedor de TODA cidade. Se o balde for dominado por comissão/PJ, ele suja todos os feeds de uma vez. Amostra de 21 não decide isso.

**40. A dedup na gravação escondia a perda; a duplicata real era outra (23/10).** A medição da trava 5 deu **zero duplicatas** no feed — por construção: `jobs.dedup_key` (empresa + cargo) é única, então toda repetição era DESCARTADA no insert. O problema estava no que ia embora.

- **31% das vagas aprovadas de Gupy + InfoJobs não viravam linha de `jobs`** (515 de 1.645). Entre elas, a mesma rede em outra cidade: "Vendedor(a) de Loja" de BH descartada porque havia a de SP — quem buscava em BH nunca via.
- ⚠️ **Eu reportei 65% antes.** O script leu 1.000 linhas de cada tabela: **o PostgREST do Supabase devolve no máximo 1.000 linhas e ignora `limit` maior, em silêncio.** `SupabaseRest.selectTodos` pagina; a coleta diária e os scripts de medição passaram a usá-lo.

**E a duplicata que o usuário veria era outra:** a MESMA fonte publicando o mesmo anúncio dezenas de vezes. O McDonald's tinha 29 anúncios de "Atendente de Restaurante (Tijuca - Rio de Janeiro/RJ)", cada um com id, título e texto idênticos. **138 de 140 grupos repetidos tinham descrição idêntica.** Lojas diferentes não caem aí: a rede põe o bairro no título.

**O que mudou:**
1. **Gravação:** para Gupy e InfoJobs, `dedup_key = <fonte>:<id na fonte>`. A gravação também completa em `jobs` o que estava em `raw_results` sem linha — **autocura**: a primeira coleta recuperou 489 vagas sem apagar nada. Descarte: 31% → **1%** (o resto o InfoJobs recupera na próxima coleta).
2. **Exibição** (`src/feed/colapsar.ts`), a trava 5 de fato: (a) mesmo título exato + mesma descrição + mesmo lugar na mesma fonte = um cartão, com "N anúncios iguais"; (b) mesma empresa + cargo + lugar em fontes diferentes = um cartão, ficando a versão com data real e descrição mais longa.

Efeito medido: Atendente/Rio, 224 linhas → **99 cartões**, sem esconder vaga distinta; Auxiliar Administrativo/SP, 134 → 133. O feed passou a pedir 3× o que mostra, porque com folga pequena o Rio encolhia para 42 com vaga sobrando no banco.

**O que NÃO está medido:** a regra (b) nunca disparou em dado real — 0 grupos entre fontes, porque as linhas do LinkedIn Jobs de agosto já expiraram e só Gupy + InfoJobs estão na janela, e essas duas quase não se sobrepõem (achado 37). Ela está coberta por teste, não por produção.

---

## As dez travas — decididas em 28/08/2026

Estavam paradas como "decisão não tomada" espalhadas pelo documento. Foram fechadas de uma vez; o que sobra de cada uma é execução, não escolha.

**1. O post do LinkedIn é fonte secundária. A base do feed é Gupy + LinkedIn Jobs.** O achado 27 deixa de ser bloqueador: se o Google indexa o post tarde, o produto não depende mais disso para entregar feed. A sonda de 1 crédito vira curiosidade, não caminho crítico. **O que isso custa está no cabeçalho e não deve ser suavizado:** sem o post e sem o Telegram, o produto é um agregador de ATS a mais.

**2. Telegram entra como medição, não como fonte.** Nada de código antes do número. Dez canais brasileiros por `t.me/s/<canal>`, e uma pergunta só: **qual fração das mensagens é vaga que a Gupy não tem.** Custo: uma tarde, zero real. Critério de morte declarado antes de medir — se a maioria for republicação de portal, o canal é eco, a hipótese morre e o produto assume que não tem diferencial de fonte.

> **MEDIDO EM 29/08 — achado 35. A hipótese sobreviveu, estreitada.** 10,8% das 739 mensagens são anúncio informal com cargo, com zero sobreposição de empresa com a Gupy, fluxo de ~15/dia e frescor de minutos. Mas 70 das 80 vêm de UM canal, os canais de tech são 100% robô republicando LinkedIn, e descobrir canal novo é curadoria manual — o mesmo limite que tirou o Google Alerts de fonte principal. **Serve não-tech local; não serve o perfil tech/São Paulo do acervo atual.** A decisão de adotar como fonte de produção não está tomada.

**3. Passo 4 antes do Passo 5, com critério de parada.** Melhorar o feed vem primeiro. Mas "melhorar" sem fim é como o passo não termina nunca, então o Passo 4 fecha quando as três valerem: `data_publicacao` real na maioria das linhas, zero duplicata no feed, Telegram medido. Fora dessas três, não mexe — vai para o Passo 5.

**4. Uma requisição por item, em `linkedin_job` e `linkedin_post`.** É a decisão que o achado 16 registrou como "à parte, não tomada": GET anônimo em página pública vira coleta de produção. Sem cookie, sem conta, sem endpoint interno — **não é a restrição 2**, que trata do LinkedIn autenticado. Resolve quatro pendências de uma vez: `data_publicacao` real (metatag `JobPosting`), empresa nos 28% sem, modelo nos 53% null, e o corpo do post que o título reescrito pelo Google esconde.

Duas condições que fazem parte da decisão:
- **Roda só na coleta, no Actions.** A regra crítica vale igual aqui: nada de fetch no caminho request-do-usuário, mesmo sendo gratuito. Latência de N requisições é motivo tão bom quanto custo.
- **Página caída não é página vazia** (a lição do achado 24). Falha de rede precisa ser distinguível de campo ausente, senão carimbamos "sem empresa" em cima de um soluço.

**5. A mesma vaga nunca aparece duas vezes no mesmo feed.** Vira requisito de **exibição**, não só de gravação: a garantia é dada na leitura do feed, mesmo que `jobs` tenha duas linhas. Colapsar linhas no banco é destrutivo e depende de acertar a chave; colapsar na exibição é reversível e resolve o sintoma que o usuário vê. A decisão 4 barateia esta — com empresa real extraída da página, a chave `empresa + cargo` para de quebrar nos 28% sem empresa, que é a causa de boa parte das duplicatas entre fontes (achado 7). A dedup semântica continua sendo o caso de fundo, para URLs diferentes da mesma vaga.

**6. Região metropolitana vira tabela determinística.** Sai do LLM. `cidade_slug` + tabela de municípios por RM, conjunto fechado como as 27 UFs. Fecha o achado 22: São Bernardo do Campo deixa de entrar ou sair do feed por sorteio.

**7. Visitante usa o produto sem login, com teto de buscas.** Mecanismo: **ligar Anonymous Sign-ins no Supabase**. Não é tela de login para visitante — é sessão invisível criada no primeiro acesso, que é exatamente o que o teto precisa para existir. As alternativas sem sessão são piores e ficam registradas: cookie o visitante limpa e volta, IP corta gente inocente atrás do NAT da operadora.

**8. O `intitle:` no bloco de posts fica como está.** Decorrência da 1: rotular à mão os 35 casos do achado 15 era trabalho para decidir o volume de uma fonte que acabou de ser rebaixada. Sai do caminho crítico.

**9. O gasto da Serper continua manual.** O último passo de `coletar-demanda.ts` segue sendo colar em `alvos.ts` na mão. São ~118 pares na vida inteira do saldo; automatizar antes da fila estar provada esvazia crédito sem ninguém notar.

**10. Mais de uma fonte é permitido — e fonte nova só entra depois de medida a sobreposição.** O schema aguenta (`fonte` já é coluna, dedup já é por chave). O que cada fonte cobra não é crédito: é normalizador próprio, modo de falha próprio e dedup contra todas as outras. **Volume que já temos não é ganho.** Risco específico de agregador: Jooble e Adzuna, que a restrição 3 autoriza, republicam vaga da Gupy — entrariam medindo redundância, não volume. ATS brasileiro direto tem chance maior de trazer acervo novo, mas nenhum foi verificado; é sonda de uma tarde, igual à do Telegram.

---

## Decisões de produto

- **Cargo adjacente conta como vaga relevante.** Product Owner entra numa busca por Product Manager. Como a ferramenta é multi-cargo, isso precisa virar regra de **família de cargo**, genérica — nunca uma lista de exceções por segmento, que viraria manutenção manual a cada cargo novo.
  **Implementado em `src/classificar/familia.ts` (24/08):** título decomposto em senioridade + função + domínio; mesma família = mesmo domínio + mesma classe de função. O léxico é de gramática de título de vaga (`manager` é gestão para qualquer cargo), não de segmento. Se acrescentar um cargo ao produto exigir editar o léxico, a regra está errada.

---

## Decisões de schema que não podem ser adiadas

1. **Chave de dedup desde a primeira linha:** `empresa + cargo normalizado` (`chaveDedupVaga` em `src/dedupe.ts`). Sem ela o feed mostra a mesma vaga duas vezes e parece quebrado.
   **Elevado em 28/08 (trava 5): "duas vezes no mesmo feed" é proibido, não indesejado.** A garantia passou a ser de exibição — o feed colapsa na leitura mesmo quando `jobs` tem duas linhas —, porque a chave de gravação depende da extração de cargo pelo LLM, que é instável (achado 11), e de empresa, que falta em 28% das linhas.
2. **Data de publicação separada da data de coleta,** com a **origem** da data junto (`gupy_snippet` | `metatag` | `desconhecida`). Guardar só "quando coletei" perde o frescor para sempre.
3. Guardar `fonte` (`linkedin_job` | `linkedin_post` | `ats_gupy`), para o feed poder facetar por origem.

---

## Métricas

**A métrica que importa não é vaga coletada.** É **clique em "ver vaga" por usuário por semana** e **retenção no dia 7**.

O que importa é **fluxo** (vagas novas por semana por segmento), não **estoque**. Com a janela de 7 dias, fluxo e estoque passam a ser a mesma coisa por construção — o feed é, por definição, só o fluxo da semana.

`collection_runs` grava uma linha por execução com quantos resultados eram inéditos.

Sempre distinguir **problema de produto** de **problema de infraestrutura**.

---

## Pendências abertas

As travas de decisão saíram desta lista em 28/08 e viraram a seção "As dez travas". O que sobrou aqui é trabalho, não escolha. **Ordenado pelo critério de parada do Passo 4 (trava 3): as três primeiras fecham o passo.**

- ~~**[fecha o Passo 4] Testar o Telegram**~~ — feito em 29/08 (achado 35) e **descartado em 19/10**.
- **InfoJobs em produção (20/10).** Restrição 3 ampliada; `src/fontes/infojobs.ts` + `scripts/coletar-infojobs.ts` (`npm run infojobs`), gravando pela mesma rota da Gupy (`gupy-cache.ts`, agora parametrizada por fonte). Só na coleta. **Falta aplicar `migrations/0008_infojobs.sql`** — sem ela o `check` de `fonte` recusa a gravação. Michael Page e Robert Half passam nas mesmas condições e não foram medidos.
  - Primeira coleta seca, Auxiliar Administrativo/SP: 278 páginas, **43 servem**; 145 outra família, 49 fora da janela, **39 cortadas por local**. Hipótese não verificada: a busca do InfoJobs por "São Paulo" inclui a região metropolitana, e o portão corta Osasco, Guarulhos e afins — seria a trava 6 cobrando. Conferir as 39 antes de mexer. Medição do achado 37 dizia 94 porque não aplicava o portão de local.
  - Sem cron. Rodar à mão até haver uso.
- **Revisão da janela de 7 dias, 21/10 — recomendações guardadas, nada implementado.**
  - O filtro de 7 dias POR FONTE está bom onde há data: Gupy e InfoJobs ordenam por publicação (verificado em 21/10, inclusive no endpoint novo da Gupy). LinkedIn Jobs e posts não têm data — `qdr:w` filtra índice, não publicação (achado 19).
  - **O que quebra a janela é a falta de coleta contínua.** Em 21/10 o feed servia 79 de 373 linhas: todo o resto expirou porque nada coleta todo dia.
  - **(1) feito em 22/10:** `.github/workflows/coleta-diaria.yml` + `scripts/coleta-diaria.ts` (`npm run diaria`), cron às 04h de Brasília, pré-carga em `src/config/pre-carga.ts` (10 cargos × 5 capitais) + pares de `buscas` dos últimos 30 dias, demanda primeiro. Falha o job quando uma fonte cai na maioria das consultas — é o teste de saúde do achado 38. Primeira rodada da Gupy: 60 consultas, 0 falhas, **839 vagas novas em 1 minuto**; o feed foi de 79 para **938 linhas na janela, 100% com data real**. **O cron só dispara no branch padrão (`main`)**, que está atrás desde `f7136c7`.
  - **Recomendado, em ordem:** (1) agendamento diário no Actions para Gupy + InfoJobs nos pares que já tiveram demanda; (2) pré-carga antes de abrir ao público — cargos mais buscados × capitais, ~50 pares cabem numa madrugada; (3) Greenhouse coletado inteiro por empresa (cobre tech em qualquer busca, ~50 requisições/dia); (4) depois, par novo dispara coleta do InfoJobs em segundo plano, com aviso na tela.
  - **Decidido pelo Pedro em 22/10: o LinkedIn Jobs continua no feed**, mesmo sem data real (janela efetiva de até 14 dias para ele, dita no cartão como "vista em").
  - ~~Vagas "em Todo Brasil" do InfoJobs~~ — **decidido em 22/10: entram, só as de home office** (achado 39). **Aplicar `migrations/0009_contrato_e_pagina_html.sql` antes de rodar o `web/`** — o feed passou a ler `tipo_contrato`, e sem a coluna a consulta falha.
  - **Bug corrigido em 21/10 (`f6985be`):** busca do InfoJobs sem UF virava estadual (`sao-paulo`) ou nacional (`belo-horizonte`). As "39 cortadas por local" eram o estado inteiro, não região metropolitana.
  - **Buraco que nenhuma das quatro fecha:** tech fora das capitais.
- **Teste de saúde das fontes** (achado 38). A Gupy ficou em 404 por semanas sem ninguém saber. Uma consulta conhecida por fonte, rodando sozinha, falhando alto.
- **Trava 4 em xeque** (achado 38): medir ritmo e retentativa na página pública do LinkedIn antes de construir em cima dela.
- **Greenhouse como fonte** (achado 36): descobrir slugs brasileiros por SERP. A sobreposição com `jobs` saiu quase nula, com amostra fraca.
- **Desenhar o currículo adaptado:** onde o CV mora, consentimento LGPD, retenção, e qual métrica mede o diferencial (CV gerado → candidatura, além de clique em "ver vaga").
- **[fecha o Passo 4] Uma requisição por item na coleta** (trava 4). Fecha `data_publicacao`, empresa, modelo e corpo do post de uma vez. Só no Actions, nunca no request do usuário, e com falha de rede distinguível de campo ausente.
- ~~**[fecha o Passo 4] Garantir zero duplicata na exibição do feed** (trava 5)~~ — **feito em 23/10, achado 40.** Colapso na exibição em duas regras, dedup de gravação por id da fonte, autocura das vagas descartadas. A regra entre fontes não disparou em produção ainda.
- **Ligar Anonymous Sign-ins no Supabase** (trava 7). O caminho já está pronto no código — `is_anonymous` lido, teto aplicado. Falta o botão no dashboard.
- **Região metropolitana determinística** (trava 6, achado 22). `cidade_slug` + tabela de municípios por RM.
- **Segunda fonte gratuita brasileira** (trava 10). A Gupy sustenta o caso de cargo novo sozinha, o que é risco de fonte única. Nenhum candidato foi verificado; a sonda mede **sobreposição com o acervo atual**, não volume.
- **Medir se post converte — mas só no Passo 5.** Posts são 19 de 248 itens (7,7%) com a MAIOR taxa de aprovação de todas as fontes (95%): quando aparece, é vaga boa. Cliques por usuário por semana não existem porque não há deploy. Com o post rebaixado (trava 1), essa medição deixou de ser urgente: ela decide se vale reinvestir na fonte, não se o produto entrega feed. `/ir/[id]` já grava o clique.
- **Fechar a conta do achado 27 custa 1 crédito** e continua sem ser feito. Repetir a sonda da frase exata do post e ver quando ele aparece no índice. Não é mais caminho crítico — é a diferença entre "o Google demora" e "o Google não indexa", que muda o que se escreve sobre a fonte, não o que se constrói.
- **Telemetria escreve durante o render** (achado 25). A janela de 60s remenda o dobro; a correção estrutural é tirar a escrita do render.
- **Deploy da tela e SMTP próprio.** `web/` roda local e o build passa, mas não está na Vercel. E o remetente padrão do Supabase limita e-mails por hora: serve para um usuário testando, não para as dez pessoas do Passo 5.
- **`data_publicacao` continua null na prática,** e enquanto isso a janela de 7 dias é uma janela de até 14. O fix da regex da Gupy recupera 9 de 57 na próxima coleta; o LinkedIn não tem sinal na SERP (achado 19), mas tem na página (trava 4).
- **58% das vagas sem modelo de trabalho,** e a leitura determinística recuperou 0 (achado 20). Sem modelo, a vaga não entra no balde remoto do feed. Resolvido pela trava 4.
- **30% das vagas gravadas ficaram sem empresa** e aparecem como `"não identificada"`. Ruim de mostrar no feed e impede dedup entre fontes. Resolvido pela trava 4.
- **`GROQ_KEY` não existe.** O `classificador.yml` já a referencia e o código trata ausência sem quebrar, mas sem ela não há reserva quando a cota diária do Gemini estourar: a rodada para em vez de continuar. O id de modelo padrão do Groq (`llama-3.3-70b-versatile`) nunca foi exercitado e pode estar morto como o do Gemini estava.
- **Repetir o harness três vezes antes de citar 95% como número.** Duas rodadas idênticas deram conjuntos diferentes de falso negativo, com `temperature: 0`.
- **Recoletar guardando o snippet no golden set.** Hoje ele só tem título e URL, e sem snippet o bloco de posts não é avaliável — 23 dos 49 casos de post estão `indeterminado`.
- **A dedup de cargo por chave continua frágil,** porque a chave depende da extração de cargo pelo LLM, que varia entre rodadas (achado 11). A trava 5 tirou o sintoma do feed; a causa segue lá, e reaparece em qualquer lugar que use `chaveDedupVaga` para outra coisa que não exibição.
- **Classificar cargo que não seja Product Manager.** A única rodada de produção foi 100% PM. Roda o coletor nos outros alvos (~84 créditos) e classifica de novo.
- **Desenho dos tiers** (precisão × quantidade × preço). Base de custo: ~16 créditos por par cargo×cidade. Continua bloqueado por não haver dado de retenção.
- **Saldo da Serper é finito.** 2.500 créditos, sem renovação, validade de **6 meses** (vence por volta de 22/02/2027). Consumidos até 24/08: 244. Uma rodada completa custa ~84.
- **A coleta não roda em cron, por decisão do Pedro (24/08).** Coletar todo dia sem front-end lendo o banco seria gastar saldo para ninguém. O `schedule` está comentado no workflow. Religar quando o Passo 4 existir — ou antes disso, se for medir fluxo semanal.
- **Sem cron, o Supabase pausa por ociosidade.** O plano free suspende projeto sem atividade. Depois de algumas semanas parado, a primeira coleta vai falhar na conexão até despausar pelo dashboard. Não é bug do coletor.

---

## Roadmap

| Passo | Estado |
|---|---|
| 1 — Validação manual com Google Dorks | ✅ concluído (com correção sobre filtro de data) |
| 2 — Coletor | ✅ **pronto, rodando sob demanda.** Repo em github.com/OrdepPedro/wagas (privado). Sem cron: o saldo da Serper não renova e não há front-end lendo o banco ainda |
| 3 — Classificador com harness de avaliação | ✅ **pronto e medido.** Pipeline completo com precisão 100% e recall 95% sobre 120 casos rotulados. Roda sob demanda pelo Actions |
| 4 — Feed mínimo (Next.js + Supabase Auth) | 🔨 **funcionando local, sem deploy.** Migrations 0004–0007, `web/` com Auth por link mágico, busca de qualquer cargo pela API pública da Gupy, toggle Só Remoto, teto diário, clique em `/ir/[id]` e fila de coleta paga |
| 5 — Ingestão por e-mail e teste com 10 usuários reais | pendente. Inclui Vercel, SMTP próprio e Anonymous Sign-ins |

**O Passo 4 fecha com três condições, e só com elas** (trava 3, 28/08): `data_publicacao` real na maioria das linhas, zero duplicata no feed, Telegram medido. Melhoria fora dessas três é o Passo 4 não terminando nunca — o resto vai para o Passo 5.

**Telegram medido em 29/08** (achado 35) — a terceira condição está cumprida. Faltam as duas de dado.

**As três cumpridas em 23/10:** data real em 100% das vagas da janela (938 de 938 em 22/10, pela coleta diária de Gupy + InfoJobs); zero duplicata no feed (achado 40); Telegram medido. **O Passo 4 fecha quando este trabalho chegar ao `main`.**

**Não ajude o Pedro a pular etapas.**

---

## Como trabalhar com o Pedro

- **Português do Brasil, prosa direta, sem preâmbulo.**
- É PM com background em UX Writing e Product Design. Assuma vocabulário de produto e de tecnologia; não explique o básico.
- Priorize por **impacto na validação da hipótese**, não por elegância técnica.
- Quando ele trouxer dados, **analise como cético, não como parceiro entusiasmado**. Aponte o que contradiz a hipótese antes do que a confirma.
- Se ele estiver ampliando escopo antes de validar o passo anterior, diga isso.
- Exija números. "Foi bom" não é medição — peça contagem, precisão e duplicação.
- **Calibre o ceticismo ao contexto.** O padrão é MVP, onde o objetivo é aprendizado barato. Não confunda "não é ótimo ainda" com "não deve existir".
- Quando ele contestar uma leitura sua e tiver razão, conceda de forma explícita e diga o que você errou.
- **Verifique premissa antes de afirmar.** Esta sessão queimou tempo dele em quatro tentativas contra uma API descontinuada porque a hipótese "é erro de configuração" não foi checada contra a possibilidade mais simples. Erro repetido com a mesma mensagem é sinal de premissa errada, não de configuração.
- **Não invente variante de dork.** Acrescentar um termo a um dork validado invalida a precisão medida. Se mudar, meça de novo.
