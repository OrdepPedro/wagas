# Passo 1 — Validação manual via índice do Google

**Perfil-alvo:** Product Manager (todos os níveis) · Remoto + Híbrido · Belo Horizonte/MG
**Data de referência:** 21/08/2026

---

## Antes de rodar: defina o critério de falha

Fechado em 21/08/2026, **antes** de rodar o primeiro dork. Não renegociar depois de ver os números.

| Item | Valor | Por quê |
|---|---|---|
| Vagas únicas e relevantes | **≥ 25** | Deduplicadas entre os 20 dorks. Abaixo disso o feed não sustenta uma primeira sessão — usuário abre, vê 8 vagas, não volta no dia 7. |
| Idade máxima da vaga | **≤ 14 dias** | Acima disso o pipeline já está cheio. Se a maioria for mais velha, é agregador de arquivo morto, não feed. |
| Precisão nos 20 primeiros | **≥ 40%** | 8 de 20 aproveitáveis. Abaixo disso o classificador vira o gargalo e o custo por vaga útil explode. |

### Se ficar abaixo: **não escrevo o coletor.**

Saídas possíveis, em ordem:

1. **Trocar o recorte** — BH/MG → Brasil, ou remoto → só híbrido. Rodar de novo com o mesmo critério.
2. **Trocar a fonte primária** — se o Bloco C (ATS) carregar sozinho e o Bloco B (posts) não entregar, o produto vira agregador de ATS e o diferencial pretendido não existe.

A opção 2 é a descoberta mais valiosa possível neste passo, e custa uma tarde em vez de três semanas de código.

### Critério de sucesso parcial

Se A+C passarem e B falhar: a plataforma é viável, a tese não. Decidir explicitamente se vale construir um agregador sem diferencial antes de seguir para o Passo 2.

---

## Bloco A — Páginas oficiais de vaga (`linkedin.com/jobs/view`)

**A1 — Baseline literal**
```
site:linkedin.com/jobs/view "Product Manager" "Belo Horizonte"
```
Testa se o Google indexa páginas de vaga do LinkedIn com o par cargo+cidade no corpo.

**A2 — Sinal no título vs. corpo**
```
site:linkedin.com/jobs/view intitle:"Product Manager" "Belo Horizonte"
```
Testa se restringir ao `<title>` aumenta precisão sem colapsar o volume — comparação direta com A1.

**A3 — Sinônimos PT-BR**
```
site:linkedin.com/jobs/view ("Gerente de Produto" OR "Product Owner" OR "Coordenador de Produto") "Minas Gerais"
```
Testa se o mercado brasileiro usa títulos alternativos que um filtro só por "Product Manager" perderia.

**A4 — Gatilho de remoto, sem âncora geográfica**
```
site:linkedin.com/jobs/view "Product Manager" ("remoto" OR "home office" OR "100% remoto")
```
Testa a hipótese de que vaga remota **não** cita cidade — se A1 e A4 quase não se sobrepõem, localização e modelo são filtros mutuamente destrutivos.

**A5 — Cinturão metropolitano para híbrido**
```
site:linkedin.com/jobs/view "Product Manager" ("híbrido" OR "hybrid") ("Belo Horizonte" OR "Nova Lima" OR "Contagem" OR "Betim")
```
Testa se ampliar a RMBH recupera volume que "Belo Horizonte" sozinho perde.

**A6 — Slug de URL em vez de conteúdo**
```
inurl:jobs/view "product-manager" site:br.linkedin.com
```
Testa se o slug da URL é um sinal mais barato e estável que o texto da página — relevante para o pré-filtro regex do Passo 3.

**A7 — Frescor**
```
site:linkedin.com/jobs/view "Product Manager" "Brazil" after:2026-08-07
```
Testa se `after:` filtra por data de publicação da vaga ou por data de crawl. Aposta: crawl. Se os resultados incluírem vagas antigas, frescor não sai de graça do índice.

**A8 — Negativos para precisão**
```
site:linkedin.com/jobs/view "Product Manager" -"Product Marketing" -intitle:"Engineer" -intitle:"Designer"
```
Testa quanto do ruído é "Product Manager" como substring de outro cargo — mede o teto de precisão sem LLM.

---

## Bloco B — Posts de recrutador (`linkedin.com/posts`)

Este bloco é o diferencial do produto. **É também o bloco com maior chance de invalidar a tese.** Trate volume baixo aqui como resultado, não como ajuste de query.

**B9 — Baseline informal**
```
site:linkedin.com/posts "vaga" "Product Manager" "Belo Horizonte"
```
Testa se posts soltos de recrutador em BH chegam a existir no índice do Google.

**B10 — Gatilhos de contratação PT-BR**
```
site:linkedin.com/posts ("estamos contratando" OR "vaga aberta" OR "temos oportunidade") "Product Manager"
```
Testa se as expressões de abertura de vaga em português são um gatilho de alta cobertura.

**B11 — Gatilhos EN / vagas LATAM**
```
site:linkedin.com/posts ("we're hiring" OR "we are hiring" OR "now hiring") "Product Manager" ("Brazil" OR "LATAM")
```
Testa se empresas estrangeiras contratando no Brasil aparecem só em inglês — segmento invisível para dorks em PT.

**B12 — Call-to-action como assinatura de post real**
```
site:linkedin.com/posts "Product Manager" ("manda um DM" OR "chama no direct" OR "envie seu currículo" OR "comenta aqui")
```
Testa se o CTA é um discriminador melhor que a palavra "vaga" — é o que separa anúncio real de post opinativo sobre o mercado.

**B13 — Sinal no título do post**
```
site:linkedin.com/posts intitle:"hiring" "product manager"
```
Testa se o `<title>` do post (que o LinkedIn monta com o começo do texto) carrega sinal aproveitável — se sim, classificar fica muito mais barato.

**B14 — Hashtag + frescor**
```
site:linkedin.com/posts "#vagas" ("Product Manager" OR "Gerente de Produto") after:2026-08-07
```
Testa se a hashtag melhora recall e se o índice tem posts das últimas 2 semanas — frescor de post é pior que frescor de vaga formal.

**B15 — Anti-infoproduto**
```
site:linkedin.com/posts ("Product Manager" OR "PM pleno" OR "PM sênior") ("remoto" OR "home office") -"curso" -"mentoria" -"ebook" -"inscrições"
```
Testa qual fração dos posts sobre PM é venda de curso, não vaga. Aposta: fração alta.

**B16 — Pedido de indicação**
```
site:linkedin.com/posts ("aceito indicações" OR "conhece alguém" OR "indicações são bem-vindas") "Product Manager"
```
Testa se a vaga que só existe como pedido de indicação é capturável — é o caso mais extremo do seu diferencial.

---

## Bloco C — ATSs brasileiros

**C17 — Gupy**
```
site:gupy.io "Product Manager" ("Belo Horizonte" OR "remoto")
```
Testa a densidade do maior ATS brasileiro no índice — provavelmente sua melhor fonte por custo/benefício.

**C18 — Sólides**
```
site:solides.jobs ("Product Manager" OR "Gerente de Produto") "Minas Gerais"
```
Testa se o Sólides tem massa em MG (empresa mineira — viés esperado a favor).

**C19 — ProgramaThor com recorte temporal amplo**
```
site:programathor.com.br inurl:vagas "product manager" after:2026-07-21
```
Testa uma janela de 30 dias em ATS de nicho tech — mede se volume baixo é falta de vaga ou falta de indexação.

**C20 — Abler (subdomínios de empresa)**
```
inurl:abler.com.br ("Product Manager" OR "Produto") "Belo Horizonte"
```
Testa se `inurl:` alcança páginas de carreira hospedadas em subdomínios — padrão de ATS white-label que `site:` restrito perderia.

---

## Rodada 2 — correções após o primeiro teste (21/08/2026)

### Substituições

**A6-v2 — slug de URL (o original devolvia perfis, não vagas)**
```
site:linkedin.com/jobs/view inurl:product-manager
```
O erro foi `site:br.linkedin.com` com `inurl:jobs/view` solto — o `inurl:` não amarrou e a busca caiu para perfis. Aqui o `site:` já restringe o caminho e o `inurl:` só testa o slug do cargo.

**B13-v2 — cargo no título, gatilho no corpo (o original trazia meta-post sobre contratação)**
```
site:linkedin.com/posts intitle:"product manager" ("contratando" OR "vaga" OR "hiring")
```
Inversão do original: `intitle:"hiring"` capturava artigo sobre recrutamento. Post de vaga real começa pelo **cargo**, não pelo verbo.

### Diagnóstico dos ATSs mortos — sonda de domínio nu

C18, C19 e C20 devolveram zero. Antes de reescrever query, descubra se o domínio está indexado. Rode nesta ordem e pare quando aparecer resultado:

```
site:solides.jobs
site:solides.jobs "product manager"
```
```
site:programathor.com.br
site:programathor.com.br "product manager"
```
```
site:abler.com.br
site:abler.com.br "product manager"
```

Leitura do resultado:

- **Domínio nu = 0 resultados** → o ATS não está no índice do Google. Problema estrutural, não de query. Risque a fonte do Passo 2.
- **Domínio nu = milhares, com cargo = 0** → a fonte existe mas não tem PM. Problema de mercado, não de infra.
- **Domínio nu = milhares, com cargo > 0** → minha query da rodada 1 estava sobre-restrita. Reconstrua removendo um operador por vez.

Nota sobre C20: páginas de carreira do Abler costumam ficar em subdomínio de empresa ou domínio próprio da contratante. É plausível que `site:abler.com.br` seja zero mesmo com o ATS em uso — nesse caso a fonte é inalcançável por dork de domínio.

### Teste de frescor (C17 — Gupy)

O `after:` no Gupy devolveu pouco. Duas causas possíveis, com consequências opostas:

1. O `after:` filtra por data de crawl e está descartando vaga nova — **problema de infraestrutura**.
2. O índice realmente não tem vaga de PM recente em BH — **problema de produto** (frescor).

Para separar, rode sem recorte temporal:
```
site:gupy.io "Product Manager" ("Belo Horizonte" OR "remoto")
```
Abra os 10 primeiros e **leia a data de publicação na própria página da Gupy**, não a data que o Google mostra.

- Vagas dos últimos 14 dias no topo → `after:` é o culpado. Descarte o operador e resolva frescor no Passo 2 com `dateRestrict` da PSE + data extraída da página.
- Nada recente → frescor é problema de produto. Precisa ser resolvido antes do coletor, porque nenhum volume de coleta conserta feed velho.

### Risco de concentração

Se só a Gupy sobreviver, sua camada de ATS é fonte única. Não resolva agora — mas registre: no Passo 2, uma mudança de layout ou de robots.txt da Gupy derruba o bloco C inteiro.

---

## Leitura da rodada 1 (21/08/2026)

### Veredito: **não dá para decidir ainda.** O critério principal segue sem medição.

| Critério | Alvo | Resultado | Status |
|---|---|---|---|
| Vagas únicas e relevantes | ≥ 25 | não contado ("N; imensurável" em 16 dorks) | **em branco** |
| Idade máxima | ≤ 14 dias | Bloco A forte; Bloco B misto; C17 marginal (12d) | parcial |
| Precisão | ≥ 40% | 100% reportado em 16 de 20 | **medição suspeita** |

### 1. "100% de precisão" quase certamente mede outra coisa

Precisão de 100% em 16 dorks diferentes — incluindo A4 e A5, que não têm âncora geográfica — não é resultado plausível. A leitura provável: contou-se *"é uma página de vaga?"* em vez de *"é uma vaga de PM que serve para o perfil-alvo e que eu clicaria?"*.

Num dork `site:linkedin.com/jobs/view`, **todo** resultado é página de vaga por construção. Isso torna a métrica tautológica. O que precisa ser contado é aderência ao perfil: cargo, senioridade, modelo e localização.

### 2. "N; imensurável" respondeu à pergunta errada

O total inflado que o Google exibe é de fato inútil — a coluna está mal nomeada e a culpa é minha. O que importa nunca foi o total: é a contagem de vagas únicas nos 20 primeiros, depois de deduplicar. Essa contagem ainda não existe, e é ela que decide o Passo 2.

### 3. O dado mais valioso da rodada: o Bloco A é redundante

- A2 → 90% duplicado de A1
- A5 → 100% duplicado (A1 + A2)
- A8 → 60% duplicado
- A3, A4, A7 → duplicação perto de zero

Oito dorks, **~4 estratégias reais**: A1 (baseline), A3 (sinônimos PT-BR), A4 (remoto sem geo), A7 (recorte temporal).

Consequência direta para o Passo 2: com 100 queries/dia de cota na PSE, rodar as 8 variantes queima metade da cota para buscar o mesmo conjunto. O plano de coleta deve usar as 4.

### 4. `after:` é redundante, não quebrado

A5 usou `after:` e voltou 100% duplicado de A1/A2 — que já traziam vagas de menos de 24h. O operador não está filtrando errado; ele não acrescenta nada, porque o índice do LinkedIn já é fresco. Descartar do plano de coleta.

### 5. Frescor: LinkedIn ganha da Gupy

Bloco A traz vagas de menos de 24h. C17 (Gupy) tem a mais recente com **12 dias** — dentro do limite, mas por pouco, e uma ordem de grandeza pior.

### 6. Bloco B: recall alto, frescor ruim nos dois dorks de maior alcance

B9 traz posts de vários meses; B10 traz maioria com mais de 1 mês. São justamente os dois de maior cobertura. Os demais (B11, B12, B14, B15, B16) ficam em 5–8 dias, o que é bom — mas B12 é o único com contagem real: **15 resultados**.

**Duplicação 0% em quase todo o Bloco B precisa ser verificada.** B10 e B15 miram o mesmo universo com vocabulário parecido; overlap zero entre eles é improvável. Se o número for real, o Bloco B é a fonte de maior recall do projeto — o que sustentaria o diferencial. Vale confirmar antes de acreditar.

### 7. Pendências não executadas

- C18, C19, C20 marcados "-": a sonda de domínio nu não foi rodada. O risco de fonte única na Gupy segue aberto.
- B13-v2 não testado (o 0 registrado é do B13 original, já sabidamente quebrado).

---

## Rodada 3 — executada na SERP real do Google (21/08/2026)

Dorks rodados: A1 (2 páginas), A3, A4, B12, C17 + sondas de domínio nu dos três ATSs.

### Veredito: **critério atendido. Passo 2 liberado — com uma ressalva grave.**

| Critério | Alvo | Medido | Status |
|---|---|---|---|
| Vagas únicas e relevantes | ≥ 25 | **~46** | ✅ |
| Vaga mais recente | ≤ 14 dias | **< 1 hora** (A4/Locaweb); "Anunciada 00:51:29" (A1) | ✅ |
| Precisão | ≥ 40% | A1 ~90% · A4 ~100% · C17 100% · A3 ~55% · **B12 ~25%** | ✅ em 4 de 5 |

### Precisão por dork

| Dork | Relevantes / 10 | Leitura |
|---|---|---|
| A1 | ~19/20 | Só 1 falso positivo claro (uma vaga em Mountain View, CA). |
| A3 | ~5-6/10 | Puxa "Líder de Produtos Financeiros" da Renner e do Shopping Del Rey — gestão de produto financeiro de varejo, não PM de tecnologia. Classe de falso positivo previsível. |
| A4 | 10/10 | Todas PM + remoto. Zero sobreposição com A1. |
| B12 | 2-3/10 | **Abaixo do limite.** Ver abaixo. |
| C17 | 10/10 | Duas em BH (Localiza, Bernoulli), oito remotas. |

### O Bloco B falhou — e é o seu diferencial

Dos 10 resultados do B12, apenas 2 ou 3 são vaga de verdade (dois posts do mesmo recrutador + um post com `#contratando`). O resto:

- 2 posts da mesma pessoa vendendo mentoria ("chama no direct para conhecer meu programa")
- 1 post de opinião ("Quem tá errado? Comenta aqui")
- 1 post de autopromoção de perfil
- 1 post com estatística de mercado
- 2 vídeos sem relação

**Eu estava certo sobre o infoproduto e errado sobre onde ele apareceria.** O B15 tinha `-curso -mentoria -ebook` embutido e por isso pareceu limpo na rodada 1 — o filtro estava carregando o resultado. O B12 não tem negativos e o ruído aparece inteiro.

Isso é exatamente o cenário de **sucesso parcial** previsto: A e C passam, B falha. A plataforma é viável; a tese de capturar post de recrutador ainda não está demonstrada.

Observação adicional: nenhum post do B12 era de BH. Todos home office ou nacional.

### ATSs — sondas de domínio nu

| ATS | Domínio indexado? | Vagas de PM? | Veredito |
|---|---|---|---|
| **Gupy** | sim | 10/10 | Única fonte viável. |
| **Sólides** | ~7 resultados, todos infra interna (`spike.`, `devfront.`, `developer.api.`, `releasev3.`, `portal.homolog…`) | **zero** | Páginas de vaga não estão nesse domínio. Riscar do Passo 2. |
| **ProgramaThor** | sim, com vagas | ~1 | "Product Manager" aparece sobretudo em *blog* e na descrição de **outros** cargos ("apoio técnico ao Product Manager"). Baixo valor para PM. |
| **Abler** | sim, muitos subdomínios de empresa | **zero** | Base de clientes não é tech: Psicólogo, Maqueiro, Nutricionista, Operador de CNC. Riscar. |

Ironia útil: a **Sólides tem uma vaga de PM aberta** — mas só apareceu via LinkedIn (A1), não pelo próprio ATS.

**Risco de fonte única confirmado.** A camada de ATS é a Gupy, sozinha.

### Frescor — sua medição estava pessimista

Você registrou 12 dias como a vaga mais recente da Gupy. A SERP mostra **"há 2 dias"**, e várias de 04/08 e 13/08. A Gupy expõe `Publicada em DD/MM/AAAA` no snippet — **o melhor sinal de data estruturado de todas as fontes**, melhor que o LinkedIn, que só dá "há 1 semana".

Frescor não é problema neste projeto. O A4 trouxe uma vaga da Locaweb publicada **há 1 hora**.

---

## Achados técnicos para os Passos 2 e 3

**1. O snippet do LinkedIn está contaminado pela barra lateral.** A página de uma vaga da Hotmart traz no snippet uma vaga do Google. Um pré-filtro regex que ler o snippet vai atribuir vaga à empresa errada. **A extração precisa vir da página, não do snippet da PSE.**

**2. Classe de falso positivo: "Product Manager" citado dentro da descrição de outro cargo.** Vagas de Tech Lead e Data Engineer mencionam "apoio ao Product Manager". O regex do pré-filtro precisa exigir o termo no **título**, não no corpo.

**3. Segunda classe de falso positivo: "Líder/Especialista de Produtos" em varejo e serviços financeiros.** Não é PM de tecnologia. Precisa de caso rotulado no harness do Passo 3.

**4. ID de vaga do LinkedIn como proxy de idade.** IDs são monotonicamente crescentes — dá para descartar vaga velha pela URL, antes de gastar token de classificação.

**5. Cota da PSE.** A1 e A4 têm sobreposição zero e precisão alta — são as duas queries de maior retorno. A3 tem metade da precisão. A5 e A2 são redundantes com A1. Plano de coleta: A1, A4, C17 como base diária.

---

## Rodada 4 — Bloco B consertado (21/08/2026)

Decisão do PM: o Bloco B entra junto com A e C. Os dorks abaixo foram testados na SERP real e resolvem o problema de precisão.

**B17 — cargo no título, gatilho no corpo, negativos de infoproduto**
```
site:linkedin.com/posts intitle:"product manager" ("contratando" OR "vaga" OR "hiring") -curso -mentoria -programa
```
**10/10 posts de vaga real.** Zero infoproduto, zero post de opinião.

**B18 — vocabulário de anúncio formal**
```
site:linkedin.com/posts "product manager" ("requisitos" OR "benefícios" OR "CLT" OR "PJ") ("vaga" OR "contratando") -curso -mentoria -programa
```
**10/10 posts de vaga real.** Exigir `requisitos`/`benefícios`/`CLT`/`PJ` é o discriminador mais forte encontrado: post de opinião não usa esse vocabulário.

### Precisão: de ~25% para ~100%

O que estava errado no B12 não era o campo, era a query. Três correções fizeram o trabalho:

1. **Cargo no título** (`intitle:`) em vez de gatilho no título — post de vaga começa pelo cargo
2. **Negativos de infoproduto** (`-curso -mentoria -programa`) — elimina a venda de mentoria no direct
3. **Vocabulário de anúncio** (`requisitos`, `benefícios`, `CLT`, `PJ`) — post opinativo não tem

### O problema que sobrou no Bloco B não é ruído. É frescor.

| Dork | Distribuição de idade |
|---|---|
| B17 | 4 de 10 com ≤ 1 semana; restante entre 2 semanas e 5 meses |
| B18 | pior — inclui posts de **1 ano** e **2 anos** |

Causa: o ranking de post no Google segue engajamento, não data. Post antigo com 280 reações vence post novo com 1 reação. **`sort=date` ou `dateRestrict` na coleta é obrigatório para o Bloco B** — ao contrário do Bloco A, onde o índice já é fresco sozinho.

### Achado que ameaça o diferencial

Metade dos posts encontrados são **republicação de vaga formal que o Bloco C já captura**:

- Omie — Product Manager (Cash Management) → aparece na Gupy **e** como post
- Grupo Boticário — Especialista I → Gupy **e** post
- banQi — Associate Product Manager Pleno → Gupy **e** post

A conta é puxada por um único perfil agregador, **"Quero Home - Vagas Home Office"**, que apareceu 5 vezes em 10 e reposta vaga de ATS como post.

Post genuinamente exclusivo (sem correspondente em ATS) nos resultados: Atlas Technologies, Carolina Eirado (Brasília), Marcela C. Ferreira (Growth PM, R$19–25k), Bruna Kuciack (Baze), Daniela Santos (Shopify, USD), Richardyson S.

**Leitura: ~50% do Bloco B é duplicata do Bloco C.** A tese "existe vaga que só aparece como post" está parcialmente sustentada — mas o ganho líquido é metade do que o volume bruto sugere. A dedup semântica com pgvector deixa de ser refinamento e vira requisito: sem ela, o feed mostra a mesma vaga duas vezes, uma pela Gupy e outra pelo post.

Nenhum dos posts era de BH. Brasília, São Paulo e remoto.

---

## Próximo passo

O critério passou; o Passo 2 está liberado. Mas a decisão que importa é sobre o Bloco B:

- Se o diferencial de posts é inegociável, ele precisa de uma rodada própria **antes** do coletor — reescrever os dorks de post exigindo cargo no título e testar se a precisão sobe de 25% para algo utilizável.
- Se o diferencial é adiável, o Passo 2 sai com A1 + A4 + C17 e o Bloco B entra depois.

Não dá para levar o Bloco B do jeito que está para o coletor: 25% de precisão vira custo de classificação sem retorno.

---

## Planilha de registro (uma linha por dork)

| # | Resultados totais | Relevantes nos 20 primeiros | Duplicados de outro dork | Mais recente (dias) | Precisão |
|---|---|---|---|---|---|
| A1 | | | | | |
| ... | | | | | |

Contar duplicados importa mais que contar totais: se A1, A2 e A4 devolvem as mesmas vagas, você não tem 3 estratégias, tem 1.
