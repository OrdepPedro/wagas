# wagas — contexto do projeto

Agregador de vagas de emprego. O usuário informa cargo e cidade, e recebe um feed de oportunidades dos últimos 7 dias.

**Diferencial pretendido:** capturar não só vagas formais, mas posts de recrutador que anunciam oportunidade apenas em texto.

**Produto multiusuário.** Não é ferramenta pessoal do Pedro. Qualquer validação feita só com o perfil dele (Product Manager, Belo Horizonte) é amostra enviesada e estreita — teste com segmentos variados.

---

## Premissa do produto (definida em 23/08/2026)

- **Janela fixa de 7 dias.** Não existe seletor de período. Se a vaga tem mais de 7 dias, não entra.
- **O usuário informa cargo + cidade.** Nada mais.
- **O feed junta três coisas:** vagas presenciais na cidade dele, híbridas na cidade dele, e remotas de todo o Brasil.
- **No free tier não há seleção de modelo de trabalho** (remoto/híbrido/presencial).
- **Fontes por vaga:** LinkedIn Jobs, posts do LinkedIn e Gupy.
- **Tiers pagos** vão diferenciar precisão e quantidade. O desenho ainda não existe.

Consequência direta na coleta: cada par cargo×cidade vira **duas consultas por bloco** — uma com a cidade, outra com os termos de remoto.

---

## Restrições inegociáveis

1. **Custo inicial zero para validar.** A validação tem que caber em tier gratuito. Custo de produção existe e é esperado (o produto terá tiers pagos), mas qualquer proposta que exija pagamento **antes** de haver dado de retenção deve ser marcada como fora de escopo, com a alternativa gratuita ao lado.

2. **Nada de scraping do LinkedIn autenticado.** Extensão que lê o DOM logado, automação de sessão ou uso de endpoints internos estão descartados: violam o Termo de Uso e arriscam banir a conta do próprio usuário. Se o Pedro pedir algo assim, recuse e lembre o motivo.

3. **Fontes válidas:** APIs de SERP que devolvam URL real e honrem operadores, alertas de e-mail/RSS que o próprio usuário configura, APIs abertas de agregadores (Remotive, RemoteOK, Arbeitnow, Himalayas, Jooble, Adzuna) e ATSs brasileiros públicos.

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

Isso vale independentemente de a coleta rodar em cron ou sob demanda: o que a regra proíbe é o caminho request-do-usuário → API paga.

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

---

## Decisões de produto

- **Cargo adjacente conta como vaga relevante.** Product Owner entra numa busca por Product Manager. Como a ferramenta é multi-cargo, isso precisa virar regra de **família de cargo**, genérica — nunca uma lista de exceções por segmento, que viraria manutenção manual a cada cargo novo.
  **Implementado em `src/classificar/familia.ts` (24/08):** título decomposto em senioridade + função + domínio; mesma família = mesmo domínio + mesma classe de função. O léxico é de gramática de título de vaga (`manager` é gestão para qualquer cargo), não de segmento. Se acrescentar um cargo ao produto exigir editar o léxico, a regra está errada.

---

## Decisões de schema que não podem ser adiadas

1. **Chave de dedup desde a primeira linha:** `empresa + cargo normalizado` (`chaveDedupVaga` em `src/dedupe.ts`). Sem ela o feed mostra a mesma vaga duas vezes e parece quebrado.
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

- **Deploy da tela e SMTP próprio.** `web/` roda local e o build passa, mas não está na Vercel. E o remetente padrão do Supabase limita e-mails por hora: serve para um usuário testando, não para as dez pessoas do Passo 5.
- **`data_publicacao` continua null na prática.** O fix da regex da Gupy recupera 9 de 57 na próxima coleta; o LinkedIn não tem sinal utilizável (achado 19). Enquanto isso a janela de 7 dias é uma janela de até 14.
- **58% das vagas sem modelo de trabalho,** e a leitura determinística recuperou 0 (achado 20). Sem modelo, a vaga não entra no balde remoto do feed. É a mesma conta da extração de empresa: uma requisição por item.
- **Solução melhor para os posts.** O bloco funciona e generaliza, mas: o título vem reescrito pelo Google, a extração de empresa/cargo exige o corpo da página (requisição a mais por item), e o volume varia muito por cargo. Em produção, com `intitle:`, ele é a MENOR fonte — 19 itens em 248, ou 7,7% do acervo, sendo o bloco que sustenta o diferencial declarado do produto. Caminhos já descartados por medição: hashtag como filtro (achado 16). Caminho vivo: rotular à mão os 35 aprovados que o dork sem `intitle:` traz a mais (achado 15).
- **Região metropolitana é julgamento instável do LLM.** O portão de local acertou 8 de 9 em produção (achado 22), e a única errada foi São Bernardo do Campo reprovada numa busca por São Paulo — com outras duas linhas da MESMA cidade aprovadas na mesma rodada. A saída determinística existe (`cidade_slug` + tabela de municípios por região metropolitana, conjunto fechado como as 27 UFs) e não foi feita.
- **`GROQ_KEY` não existe.** O `classificador.yml` já a referencia e o código trata ausência sem quebrar, mas sem ela não há reserva quando a cota diária do Gemini estourar: a rodada para em vez de continuar. O id de modelo padrão do Groq (`llama-3.3-70b-versatile`) nunca foi exercitado e pode estar morto como o do Gemini estava.
- **Repetir o harness três vezes antes de citar 95% como número.** Duas rodadas idênticas deram conjuntos diferentes de falso negativo, com `temperature: 0`.
- **Recoletar guardando o snippet no golden set.** Hoje ele só tem título e URL, e sem snippet o bloco de posts não é avaliável — 23 dos 49 casos de post estão `indeterminado`.
- **Decidir o que fazer com a dedup de cargo.** Dois posts da mesma vaga do Boticário viraram duas linhas em `jobs` porque o LLM extraiu o cargo diferente em cada um. Ou a chave normaliza o cargo com mais violência, ou só a dedup semântica resolve — que já é requisito de lançamento. É decisão de schema, não foi tomada.
- **30% das vagas gravadas ficaram sem empresa** e aparecem como `"não identificada"`. Ruim de mostrar no feed e impede dedup entre fontes. Extrair da página resolveria, ao custo de uma requisição por item — a mesma conta que trava a solução dos posts.
- **Classificar cargo que não seja Product Manager.** A única rodada de produção foi 100% PM. Roda o coletor nos outros alvos (~84 créditos) e classifica de novo.
- **Desenho dos tiers** (precisão × quantidade × preço). Base de custo: ~16 créditos por par cargo×cidade.
- **Fonte única de ATS** (Gupy). Risco registrado, não resolvido.
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
| 4 — Feed mínimo (Next.js + Supabase Auth) | 🔨 **base e tela prontas (25/08), sem deploy.** Migrations 0004 e 0005, filtro de família em SQL, `web/` com Auth por link mágico, clique em `/ir/[id]` e demanda gravada em `buscas`. Falta Vercel e SMTP próprio |
| 5 — Ingestão por e-mail e teste com 10 usuários reais | pendente |

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
