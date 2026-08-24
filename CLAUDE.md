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
| Coleta | GitHub Actions em cron chamando a **Serper.dev** |
| Complemento | Feeds RSS do Google Alerts para segmentos fixos |
| Classificação | pré-filtro regex barato → Gemini Flash-Lite, Groq como fallback, saída JSON estrito |
| Banco | Supabase (Postgres, Auth, pgvector para dedup semântica) |
| Backend | Cloudflare Workers |
| Frontend | Next.js na Vercel |
| Ingestão de e-mail | Cloudflare Email Routing + Worker |

**Regra crítica:** busca **nunca** é disparada por request de usuário. O cron popula o cache; o usuário lê o cache. Filtros são aplicados **no Postgres sobre o cache**.

**Consequência econômica que importa:** o custo escala com **pares cargo×cidade distintos**, não com número de usuários. Dez usuários pedindo "Product Manager em São Paulo" custam uma varredura, não dez.

---

## Estado atual

### Passo 1 — validado (com correções)

Detalhes originais em `passo1-google-dorks.md`. O que continua valendo: os dorks funcionam, com precisão medida de ~90–100%.

**Correção importante:** o Passo 1 concluiu que filtro de data era redundante no LinkedIn porque "o índice já é fresco". Isso está **errado** para o produto atual. Medição de 22/08: sem filtro de data, um terço do que o índice devolve tem mais de 90 dias — a busca por relevância enterra a vaga nova. Com `tbs=qdr:w`, o volume de vagas recentes **decuplica**.

O filtro de 7 dias não é só uma restrição de produto: é ganho de recall.

### Passo 2 — coletor funcionando

Node 24 + TypeScript, zero dependência de runtime (type stripping nativo, PostgREST em fetch puro). 114 testes, typecheck limpo.

**Supabase provisionado em 24/08/2026:** projeto `wagas`, ref `dvaflqmvnrelpuzhhmrr`, região `sa-east-1`, org `OrdepPedro's Org`. As duas migrations foram aplicadas e verificadas — `raw_results`, `jobs`, `collection_runs`, `api_saldo` e as funções `reservar_saldo`/`devolver_saldo` existem.

Autenticação pela **secret key nova** (`sb_secret_…`), não pela legacy `service_role`. As duas funcionam nos headers do PostgREST; a nova é o caminho que o Supabase está adotando.

Teste ponta a ponta: 20 vagas coletadas e gravadas; segunda rodada devolveu `jaNoBanco: 20, gravados: 0`, provando a dedup contra o banco.

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

**6. Gupy expõe `Publicada em DD/MM/AAAA`** no snippet. Melhor sinal de data estruturado de todas as fontes.

**7. Duplicação entre blocos confirmada com caso real.** A Omie aparece duas vezes na Gupy e uma como post do agregador "Quero Home", com **URLs diferentes** — a dedup por hash não pega. Dedup semântica é requisito de lançamento.

**8. Entidades HTML vêm com dupla codificação.** Um `&` do texto chega como `&amp;amp;`; as tags de destaque chegam como `&lt;b&gt;`. Duas regras: decodificar `&lt;`/`&gt;` **antes** de remover tags, e passar em `&amp;` **duas vezes**. Já implementado em `normalize/texto.ts`.

**9. Gupy é inversamente correlacionada com tech.** Front-end 1, PM 9, Dados 7 — contra Enfermeiro 36 e Auxiliar Administrativo 25. Não descartar por cargo tech; a fonte serve a outros segmentos.

**10. Sobreposição cidade×remoto é real e varia por cargo.** Front-end teve 15 resultados repetidos entre os dois recortes; PM teve 5. Quanto mais remoto o cargo, mais se paga duas consultas para receber uma vaga.

---

## Decisões de produto

- **Cargo adjacente conta como vaga relevante.** Product Owner entra numa busca por Product Manager. Como a ferramenta é multi-cargo, isso precisa virar regra de **família de cargo**, genérica — nunca uma lista de exceções por segmento, que viraria manutenção manual a cada cargo novo.

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

- **Solução melhor para os posts.** O bloco funciona e generaliza, mas: 26% dos títulos são genéricos, a extração de empresa/cargo exige o corpo da página (requisição a mais por item), e o volume varia muito por cargo (PM 49, Enfermeiro 8). Adiado por decisão do Pedro em 23/08.
- **Desenho dos tiers** (precisão × quantidade × preço). Base de custo: ~16 créditos por par cargo×cidade.
- **O projeto não é um repositório git.** O workflow do Actions existe mas nunca vai rodar até haver repo e push. Os secrets (`SERPER_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) também não estão cadastrados.
- **Fonte única de ATS** (Gupy). Risco registrado, não resolvido.
- **Saldo da Serper é finito.** 2.500 créditos, sem renovação, validade de 6 meses. Na cadência atual (1x/dia, 84 créditos) duram ~27 dias. Depois disso é decisão de pagar ou reduzir cobertura.

---

## Roadmap

| Passo | Estado |
|---|---|
| 1 — Validação manual com Google Dorks | ✅ concluído (com correção sobre filtro de data) |
| 2 — Coletor | ✅ **funcionando.** Serper + Supabase, gravando em `raw_results`, dedup contra o banco verificada. Falta só publicar em repo git para o cron rodar |
| 3 — Classificador com harness de avaliação | pendente |
| 4 — Feed mínimo (Next.js + Supabase Auth) | pendente |
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
