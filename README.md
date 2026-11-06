# wagas — ajuda gratuita para quem procura vaga

O wagas começou como agregador de vagas e virou um **hub gratuito para quem está procurando emprego**. A pessoa informa cargo e cidade e recebe as vagas dos últimos 7 dias. Em volta do feed há ferramentas para buscar por conta própria e para deixar o currículo pronto para cada vaga.

O diferencial não está em nenhuma ferramenta isolada. Adaptar currículo com IA virou commodity, e qualquer pessoa cola vaga e CV no ChatGPT. O que o wagas oferece é **o encaixe**: a vaga certa e o currículo adaptado a ela no mesmo lugar, sem copiar e colar. Se o feed for ruim, o resto vira só um wrapper de LLM. Por isso o feed continua sendo o centro do produto.

> Contexto, decisões e medições estão em [CLAUDE.md](CLAUDE.md). Este README descreve o que existe e como rodar.

## O que a pessoa encontra

| | O que faz | Precisa de conta? | Teto diário |
|---|---|---|---|
| **Feed de vagas** (`/vagas`) | Cargo + cidade → vagas dos últimos 7 dias: presenciais e híbridas na cidade, remotas de todo o Brasil. Toggle "Só vagas remotas". Um clique leva ao anúncio original | não | visitante: 2 buscas salvas por 7 dias · com e-mail: 10 pares/dia |
| **Gerador de buscas avançadas** (`/funcionalidades/dorks`) | Monta a busca do Google com operadores (`site:`, aspas, período) para LinkedIn, posts e 11 portais brasileiros, pronta para abrir | não | sem limite: roda no navegador |
| **Medidor de currículo para ATS** (`/funcionalidades/ats`) | Nota de 0 a 100 numa rubrica de 8 critérios: se o ATS lê o arquivo, se o CV mostra o que o cargo pede, se convence quem lê. Lista o que mais aumenta a nota | não | visitante 3 · conta 10 |
| **Currículo para LinkedIn e Gupy** (`/funcionalidades/estruturar`) | Reescreve cada campo do perfil do jeito que a plataforma lê, pronto para colar. O LinkedIn serve para ser encontrado; a Gupy, para ser bem ordenado na candidatura | não | visitante 3 · conta 10 |
| **Currículo adaptado à vaga** (`/curriculo`, `/adaptar/[id]`) | O CV fica salvo com consentimento. A partir de qualquer vaga do feed com descrição completa, a IA o reescreve para aquela vaga e entrega um PDF de uma coluna, legível por ATS. Avisa quando o texto gerado traz algo que não estava no CV | **sim**, com e-mail | 5 adaptações |

A landing (`/`) mostra uma amostra do feed e o carrossel de **cargos abrangidos**. Esse carrossel junta a pré-carga da coleta diária e os cargos sugeridos por visitantes. Um cargo sugerido só aparece na lista depois que a coleta encontra vaga para ele.

**Todas as ferramentas são gratuitas para quem usa.** Os tetos existem porque cada medição ou adaptação consome cota de tier gratuito de LLM compartilhada pelo produto inteiro. Sem teto, uma pessoa recarregando a página esgotaria a ferramenta para todo mundo.

### Extensão do Chrome (`extensao/`)

Painel lateral para adaptar o CV salvo a uma vaga que a pessoa está vendo em qualquer site. **Ela não lê a página:** a pessoa cola cargo, empresa e descrição. Não pede permissão de aba nem injeta script, então o LinkedIn logado nunca é tocado (restrição 2). Não guarda token: chama `/api/extensao/*` com o cookie de sessão do site, e quem não está logado é mandado para o site. Usa o mesmo teto diário e o mesmo caminho da adaptação do feed (só Groq, correção de nomes, alerta de fidelidade). A descrição colada vai ao modelo e não é gravada; `adaptacoes.origem = 'colada'` separa essas adaptações das do feed.

Para testar: aplicar `migrations/0018_adaptacao_vaga_colada.sql`, rodar o `web/` em `localhost:3000`, entrar com e-mail e guardar um CV. Depois, em `chrome://extensions`, ligar o modo desenvolvedor, clicar em *Carregar sem compactação* e escolher a pasta `extensao/`. Para outro endereço, trocar `extensao/config.js` e `host_permissions` no `manifest.json`. Para publicar na Chrome Web Store: `npm run extensao -- --site=https://<site>` gera o zip, e [extensao/loja/LOJA.md](extensao/loja/LOJA.md) tem todo o texto do painel, as justificativas de permissão, as imagens e o passo a passo (inclusive `EXTENSAO_ID` depois da primeira publicação). A política de privacidade está em `/privacidade`.

## Privacidade do currículo

Currículo é dado pessoal, e cada ferramenta segue uma regra explícita:

- **Medidor e estruturador são efêmeros.** O currículo é processado em memória e descartado. As tabelas `medicoes_curriculo` e `estruturacoes_curriculo` guardam só o evento: nota, contagens, hash não reversível da entrada e o "isso foi útil?". O texto nunca é gravado.
- **O currículo adaptado é salvo**, só para quem tem conta com e-mail, com consentimento gravado e um botão que apaga o CV e todas as adaptações.
- **O CV salvo vai só para o Groq.** Os termos do tier gratuito do Gemini permitem que o Google use o conteúdo enviado, então a adaptação não cai para ele. O medidor e o estruturador ainda usam o Gemini. Qual regra vale para o produto inteiro ainda não foi decidido.
- **O visitante anônimo some depois de 30 dias sem acesso** (migration 0010). Buscas e cliques continuam, mas anonimizados.

## Como o feed é montado

A regra que sustenta o custo é esta: **busca nunca é disparada pelo request do usuário quando a fonte é paga.** A coleta popula o cache e o usuário lê o cache. Os filtros de cargo, cidade, modelo e janela são aplicados no Postgres.

| Fonte | Como entra | Quando |
|---|---|---|
| **Gupy** | API pública do portal, sem chave | coleta diária + sob demanda quando aparece um par novo |
| **InfoJobs** | página pública, lendo o JSON-LD `JobPosting`, 1 req/s | coleta diária + em segundo plano quando aparece um par novo (`outra-fonte.yml`) |
| **LinkedIn Jobs** | SERP pela Serper.dev (crédito finito); data lida da página pública, 1 GET a cada 20 s | manual, por fila de demanda |
| **Posts do LinkedIn, InHire** | SERP pela Serper.dev | manual; fontes secundárias |

O pipeline tem estas etapas:

1. **Coleta.** Normaliza a URL, deduplica por hash e grava em `raw_results`.
2. **Classificação.** Um pré-filtro determinístico corta sem custo o que não serve. As fontes da SERP passam depois por um LLM (Gemini Flash-Lite, com Groq de reserva) que confirma se é vaga, se o cargo é da família buscada e se o local serve. O resultado vai para `jobs`.
3. **Exibição.** Família de cargo vira SQL (`familia.ts`: Product Owner entra em Product Manager), a cidade sai normalizada e o feed colapsa anúncios repetidos. A mesma vaga nunca aparece duas vezes, e vaga que a fonte deixou de listar sai sozinha do feed.

Cada busca grava uma linha em `buscas` com a contagem de resultados. A view `demanda_descoberta` ordena os pares que voltaram vazios por número de pessoas distintas, e é essa fila que decide onde gastar crédito da Serper. O clique em "ver vaga" passa por `/ir/[id]`, que grava o clique no servidor. Essa é a métrica que decide o produto.

## Estrutura

```
src/                       núcleo em TypeScript, compartilhado pelo coletor e pelo web/
  collect.ts               coletor da SERP: reserva crédito → busca → normaliza → dedup → grava
  classify.ts              classificador: pré-filtro → LLM → jobs
  fontes/                  Gupy, InfoJobs, página do LinkedIn, coleta sob demanda
  coleta/                  pares da coleta diária, outra fonte em segundo plano, vaga encerrada
  classificar/             família de cargo, pré-filtro, prompt, LLM, harness
  feed/                    consulta do feed, colapso de duplicatas, teto de pares
  curriculo/               medidor (rubrica + prompt), estruturador LinkedIn/Gupy, adaptação à vaga, leitura de PDF/DOCX
  dorks/gerador.ts         gerador de buscas avançadas (sites e moldes)
  cargos/abrangidos.ts     lista de cargos da landing e validação de sugestões
  normalize/               URL canônica, datas, local (cidade/UF/país), texto
  serper/  alerts/         fonte paga (Serper) e Google Alerts
  config/                  alvos da SERP, pré-carga da coleta diária, alertas
  db/  quota/              PostgREST em fetch puro, saldo de créditos
web/                       Next.js 16 (App Router) + Supabase Auth
  app/vagas                feed
  app/funcionalidades/     dorks, ats, estruturar
  app/curriculo, adaptar/  CV salvo e currículo adaptado (PDF em adaptar/[id]/pdf)
  app/ir/[id]              redirecionamento que conta o clique
  lib/                     sessão, limites, feed, leitura de currículo, geração de PDF
migrations/                SQL do Supabase, aplicado em ordem (0001–0017)
scripts/                   coleta diária, InfoJobs, datação do LinkedIn, medições
harness/golden.jsonl       casos rotulados para medir o classificador
test/                      382 testes
.github/workflows/         coleta-diaria (cron), outra-fonte (disparada pela busca), coletor e classificador (manuais)
```

O `web/` importa `../src` em vez de copiar código. Uma segunda implementação da regra de família ou da normalização de cidade divergiria da primeira, e o sintoma seria feed vazio sem causa aparente.

O núcleo não tem dependência de runtime. O Node 24 executa TypeScript direto (type stripping), então os testes rodam sem instalar nada.

## Rodar

```bash
npm test
```

```bash
npm run typecheck
```

O site, local (precisa de `web/.env.local`, modelo em [web/.env.example](web/.env.example)):

```bash
npm install --prefix web
```

```bash
npm run web
```

A coleta diária de Gupy e InfoJobs, sem gastar crédito pago:

```bash
npm run diaria
```

O classificador, só com o pré-filtro, sem gastar cota de LLM:

```bash
npm run classify -- --so-prefiltro
```

O harness do classificador, sem chave:

```bash
npm run harness:prefiltro
```

Todo script que gasta crédito aceita `--dry-run`, que imprime o plano sem chamar nada.

## Configuração

**Coletor e scripts:** copiar [.env.example](.env.example) para `.env`. As variáveis são `SERPER_KEY`, `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`, e para classificar `GEMINI_KEY` (opcional: `GROQ_KEY`).

**Site:** copiar [web/.env.example](web/.env.example) para `web/.env.local`.

- `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` vêm com a chave **pública**. A leitura do feed passa pela RLS.
- `SUPABASE_SERVICE_KEY` é server-only e serve para a coleta sob demanda gravar.
- `GEMINI_KEY` liga o medidor e o estruturador.
- `GROQ_KEY` liga o currículo adaptado. No console do Groq, ligue Zero Data Retention.
- `GITHUB_DISPATCH_TOKEN` dispara a coleta do InfoJobs em segundo plano.

Sem cada uma delas, a ferramenta correspondente responde "fora do ar" e o resto continua funcionando.

**A `sb_secret_…` nunca vai para o navegador.** Ela ignora a RLS e entregaria o acervo inteiro a qualquer visitante.

**Banco:** projeto Supabase `wagas` (`sa-east-1`). Aplique as migrations em ordem no SQL Editor. O plano free pausa projeto ocioso: se a coleta falhar na conexão depois de semanas parado, despause pelo dashboard.

**Actions:** a `coleta-diaria` roda em cron de madrugada, e só no branch padrão. O `outra-fonte` é disparado pela própria busca. `coletor` e `classificador` são manuais:

```bash
gh workflow run coletor.yml --repo OrdepPedro/wagas -f paginas=1 -f dry_run=true
```

## Créditos da Serper

São 2.500 créditos gratuitos que **não renovam** e vencem por volta de 22/02/2027. Restavam 2.074 em 30/10. Uma varredura de par cargo×cidade custa ~16 a 18 créditos. Cada execução reserva saldo antes de chamar (`api_saldo`, com `SELECT … FOR UPDATE`) e devolve o que não usou. O último passo de `coletar-demanda.ts` continua manual de propósito: automatizá-lo esvaziaria o saldo sem ninguém notar.

## O que está medido e o que não está

- **Classificador** (golden set, `gemini-3.5-flash-lite`): precisão 100%, recall 95%. Uma rodada só e 20 negativos, então o intervalo é largo. O mesmo lote classificado duas vezes dá resultados diferentes mesmo com `temperature: 0`.
- **Data real:** 100% das vagas da janela vêm de Gupy e InfoJobs (22/10). O LinkedIn Jobs ganha a data pela página e fica sem empresa em ~31% e sem modelo em ~37%.
- **Currículo adaptado:** 6 rodadas em 2 segmentos sem alerta de invenção, depois que o prompt passou a proibir acréscimos. O resultado fiel é modesto: muda título, resumo, ordem e a lista de lacunas. A capacidade é de ~1 adaptação por minuto para o produto inteiro, por causa do tier gratuito do Groq.
- **Ainda não medido:** uso real. Não há deploy na Vercel nem SMTP próprio. O acesso de visitante depende de ligar o Anonymous Sign-ins no Supabase; sem ele, a landing pede e-mail. Clique por usuário por semana e retenção no dia 7, as métricas que decidem o produto, só existem depois disso.

Detalhes, números e o histórico de cada decisão estão nos achados do [CLAUDE.md](CLAUDE.md).
