/**
 * Família de cargo.
 *
 * Decisão de produto (CLAUDE.md): cargo adjacente conta como vaga relevante —
 * Product Owner entra numa busca por Product Manager. Como a ferramenta é
 * multi-cargo, isso precisa ser uma REGRA GENÉRICA, nunca uma lista de exceções
 * por segmento: a lista viraria manutenção manual a cada cargo novo.
 *
 * A regra genérica decompõe qualquer título em três partes:
 *
 *   senioridade  jr / pleno / sênior / II / trainee     — ruído para o casamento
 *   função       manager, analista, desenvolvedor...    — o QUE a pessoa faz
 *   domínio      product, data, marketing...            — SOBRE O QUE ela faz
 *
 * Dois cargos são da mesma família quando compartilham o domínio e a CLASSE da
 * função. "Product Owner" e "Product Manager" compartilham `product` + gestão;
 * "Product Designer" compartilha o domínio mas é design, e cai fora.
 *
 * Os léxicos abaixo são de gramática de título de vaga em pt-BR/en, não de
 * segmento: `manager` é gestão para qualquer cargo, `analista` é análise para
 * qualquer cargo. Acrescentar um cargo novo ao produto não deve exigir mexer
 * aqui — se exigir, a regra está errada.
 *
 * Este módulo é a metade BARATA da decisão. Ele erra para o lado do recall de
 * propósito: o que ele deixa passar o LLM ainda julga; o que ele corta não é
 * visto por mais ninguém.
 */

/** Classe da função. O que separa "gerenciar produto" de "desenhar produto". */
export type ClasseFuncao = 'gestao' | 'analise' | 'engenharia' | 'design' | 'operacao' | 'comercial';

/**
 * Palavras de função e sua classe. Vocabulário de título de vaga, não de área.
 * `po` e `pm` entram porque aparecem soltos em título brasileiro ("PO Sênior").
 */
const FUNCOES = new Map<string, ClasseFuncao>([
  // gestão
  ['manager', 'gestao'],
  ['management', 'gestao'],
  ['gerente', 'gestao'],
  ['gestor', 'gestao'],
  ['gestora', 'gestao'],
  ['coordenador', 'gestao'],
  ['coordenadora', 'gestao'],
  ['coordinator', 'gestao'],
  ['lead', 'gestao'],
  ['leader', 'gestao'],
  ['lider', 'gestao'],
  ['head', 'gestao'],
  ['owner', 'gestao'],
  ['supervisor', 'gestao'],
  ['supervisora', 'gestao'],
  ['diretor', 'gestao'],
  ['diretora', 'gestao'],
  ['director', 'gestao'],
  ['chefe', 'gestao'],
  ['pm', 'gestao'],
  ['po', 'gestao'],
  // análise
  ['analista', 'analise'],
  ['analyst', 'analise'],
  ['especialista', 'analise'],
  ['specialist', 'analise'],
  ['consultor', 'analise'],
  ['consultora', 'analise'],
  ['consultant', 'analise'],
  ['cientista', 'analise'],
  ['scientist', 'analise'],
  ['pesquisador', 'analise'],
  ['pesquisadora', 'analise'],
  // engenharia
  ['desenvolvedor', 'engenharia'],
  ['desenvolvedora', 'engenharia'],
  ['developer', 'engenharia'],
  ['dev', 'engenharia'],
  ['engenheiro', 'engenharia'],
  ['engenheira', 'engenharia'],
  ['engineer', 'engenharia'],
  ['programador', 'engenharia'],
  ['programadora', 'engenharia'],
  ['programmer', 'engenharia'],
  ['arquiteto', 'engenharia'],
  ['arquiteta', 'engenharia'],
  ['architect', 'engenharia'],
  // design
  ['designer', 'design'],
  ['redator', 'design'],
  ['redatora', 'design'],
  ['writer', 'design'],
  // operação
  ['auxiliar', 'operacao'],
  ['assistente', 'operacao'],
  ['assistant', 'operacao'],
  ['operador', 'operacao'],
  ['operadora', 'operacao'],
  ['operator', 'operacao'],
  ['tecnico', 'operacao'],
  ['tecnica', 'operacao'],
  ['technician', 'operacao'],
  ['atendente', 'operacao'],
  ['estoquista', 'operacao'],
  // comercial
  ['vendedor', 'comercial'],
  ['vendedora', 'comercial'],
  ['representante', 'comercial'],
  ['sdr', 'comercial'],
  ['closer', 'comercial'],
]);

/**
 * Senioridade. Sai do casamento — "Product Manager Júnior" e "Product Manager
 * Sênior" são a mesma família — mas volta como campo extraído em `jobs`.
 * Numeral romano entra porque "Especialista II" e "Enfermeiro III" são comuns.
 */
const SENIORIDADES = new Set([
  'jr',
  'junior',
  'pl',
  'pleno',
  'plena',
  'sr',
  'sra',
  'senior',
  'associate',
  'trainee',
  'estagiario',
  'estagiaria',
  'estagio',
  'aprendiz',
  'principal',
  'staff',
  'master',
  'i',
  'ii',
  'iii',
  'iv',
]);

/**
 * Ruído de título: preposição, artigo e as palavras que toda vaga carrega.
 * "vaga", "hiring" e "home office" aparecem em título de post e de anúncio sem
 * dizer nada sobre o cargo.
 */
const RUIDO = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'no',
  'na',
  'para',
  'com',
  'a',
  'o',
  'as',
  'os',
  'um',
  'uma',
  'the',
  'of',
  'in',
  'at',
  'for',
  'and',
  'to',
  'vaga',
  'vagas',
  'oportunidade',
  'oportunidades',
  'hiring',
  'hire',
  'contratando',
  'contrata',
  'efetivo',
  'clt',
  'pj',
  'remoto',
  'remota',
  'remote',
  'presencial',
  'hibrido',
  'hybrid',
  'home',
  'office',
  'trabalho',
  'work',
  'empresa',
  'pagina',
  'brasil',
  'brazil',
]);

/**
 * Variantes de escrita e de idioma, aplicadas como frase ANTES de tokenizar.
 * São equivalências lexicais (pt/en, hífen, plural irregular), não sinônimos de
 * negócio: nada aqui declara que uma área é parecida com outra.
 */
const VARIANTES: Array<[RegExp, string]> = [
  [/\bfront\s+end\b/g, 'frontend'],
  [/\bback\s+end\b/g, 'backend'],
  [/\bfull\s+stack\b/g, 'fullstack'],
  [/\bprodutos?\b/g, 'product'],
  [/\bdados\b/g, 'data'],
  [/\badministrativa\b/g, 'administrativo'],
];

/** Minúsculas, sem acento, pontuação virando espaço. "Enfermeiro(a)" -> "enfermeiro a". */
export function normalizarTexto(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function aplicarVariantes(texto: string): string {
  let atual = texto;
  for (const [de, para] of VARIANTES) atual = atual.replace(de, para);
  return atual;
}

/** Plural simples. Sem stemmer: errar o radical funde cargos que não são o mesmo. */
function semPlural(token: string): string {
  return token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
}

/** Chaves de comparação de um token: ele mesmo e a forma singular. */
function chaves(token: string): string[] {
  const singular = semPlural(token);
  return singular === token ? [token] : [token, singular];
}

export function tokenizar(bruto: string): string[] {
  return aplicarVariantes(normalizarTexto(bruto))
    .split(' ')
    .filter((t) => t !== '');
}

export interface Nucleo {
  /** Funções encontradas, com a classe de cada uma. */
  funcoes: Array<{ token: string; classe: ClasseFuncao }>;
  /** Tokens de senioridade, na ordem em que aparecem. */
  senioridade: string[];
  /** O resto: o assunto do cargo. É o que precisa casar entre busca e título. */
  dominio: string[];
}

/**
 * Decompõe um cargo ou título nas três partes.
 *
 * Profissão de palavra única ("Enfermeiro", "Advogado") não tem função no
 * léxico e cai inteira em `dominio` — de propósito. A regra degrada para
 * "a palavra precisa estar no título", que é exatamente o certo nesse caso.
 */
export function decompor(bruto: string): Nucleo {
  const nucleo: Nucleo = { funcoes: [], senioridade: [], dominio: [] };

  for (const token of tokenizar(bruto)) {
    if (RUIDO.has(token)) continue;
    if (SENIORIDADES.has(token)) {
      nucleo.senioridade.push(token);
      continue;
    }
    const classe = FUNCOES.get(token);
    if (classe) {
      nucleo.funcoes.push({ token, classe });
      continue;
    }
    nucleo.dominio.push(token);
  }

  return nucleo;
}

export type MotivoNaoBate = 'dominio_ausente' | 'funcao_de_outra_classe';

export interface Casamento {
  bate: boolean;
  motivo: MotivoNaoBate | null;
  /** O que faltou. Vai para o log e para o relatório do harness. */
  detalhe: string;
}

/**
 * O título carrega o cargo buscado — ou um cargo da mesma família?
 *
 * Duas condições, nesta ordem:
 *
 *   1. TODO token de domínio do cargo buscado aparece no título. É a condição
 *      forte: sem `product` no título, "Flutter flow Lead PL" não é PM.
 *   2. Se o cargo buscado tem função E o título também, ao menos uma função do
 *      título precisa ser da mesma classe. Título SEM função reconhecida passa —
 *      cortar ali derrubaria "Enfermeiro - Clínica Mac Weber" e vaga demais.
 *
 * Erra para o recall por construção: "[TEAM PRODUCT] Flutter flow Lead PL"
 * passa nas duas condições (tem `product`, tem `lead`) e só o LLM derruba.
 * Quanto isso custa está medido no harness, não estimado aqui.
 */
export function cargoBateNoTitulo(cargoBuscado: string, titulo: string): Casamento {
  const alvo = decompor(cargoBuscado);
  const candidato = decompor(titulo);

  const tokensDoTitulo = new Set<string>();
  const todos = [
    ...candidato.dominio,
    ...candidato.funcoes.map((f) => f.token),
    ...candidato.senioridade,
  ];
  for (const token of todos) {
    for (const chave of chaves(token)) tokensDoTitulo.add(chave);
  }

  const faltando = alvo.dominio.filter(
    (token) => !chaves(token).some((chave) => tokensDoTitulo.has(chave)),
  );
  if (faltando.length > 0) {
    return {
      bate: false,
      motivo: 'dominio_ausente',
      detalhe: `título não menciona ${faltando.join(', ')}`,
    };
  }

  if (alvo.funcoes.length > 0 && candidato.funcoes.length > 0) {
    const classesAlvo = new Set(alvo.funcoes.map((f) => f.classe));
    const compativel = candidato.funcoes.some((f) => classesAlvo.has(f.classe));
    if (!compativel) {
      const doTitulo = [...new Set(candidato.funcoes.map((f) => f.classe))].join('/');
      return {
        bate: false,
        motivo: 'funcao_de_outra_classe',
        detalhe: `título é ${doTitulo}, busca é ${[...classesAlvo].join('/')}`,
      };
    }
  }

  return { bate: true, motivo: null, detalhe: '' };
}

/** Senioridade em forma canônica, para a coluna `jobs.senioridade`. */
const CANONICA: Record<string, string> = {
  jr: 'junior',
  junior: 'junior',
  pl: 'pleno',
  pleno: 'pleno',
  plena: 'pleno',
  sr: 'senior',
  sra: 'senior',
  senior: 'senior',
  associate: 'junior',
  trainee: 'trainee',
  estagiario: 'estagio',
  estagiaria: 'estagio',
  estagio: 'estagio',
  aprendiz: 'aprendiz',
  principal: 'principal',
  staff: 'staff',
  master: 'principal',
  i: 'junior',
  ii: 'pleno',
  iii: 'senior',
  iv: 'senior',
};

const ROMANO = /^i{1,3}$|^iv$/;

/**
 * Senioridade do título, ou null.
 *
 * Numeral romano só vale quando é o ÚNICO sinal: "Especialista I" é júnior, mas
 * em "Product Manager Sênior I" a palavra manda. Sem essa regra, "Enfermeiro III
 * - Internação - 12x36" viraria sênior por acidente de numeração interna do
 * hospital.
 */
export function senioridadeDoTitulo(titulo: string): string | null {
  const encontrados = decompor(titulo).senioridade;
  if (encontrados.length === 0) return null;

  const escolhido = encontrados.find((t) => !ROMANO.test(t)) ?? encontrados[0];
  return escolhido ? (CANONICA[escolhido] ?? null) : null;
}

/**
 * As mesmas duas condições de `cargoBateNoTitulo`, em forma de chave gravável.
 *
 * O feed precisa filtrar por família DENTRO do Postgres — a regra do CLAUDE.md
 * é que o filtro roda sobre o cache, e filtrar em memória no servidor só
 * funciona enquanto o acervo couber numa página. `cargo_normalizado` não serve:
 * as 197 linhas gravadas têm 15+ valores distintos para 6 cargos (`senior
 * product manager`, `growth product manager`, `product manager jr`), e igualdade
 * devolveria quase nada.
 *
 * A tradução é literal, não uma aproximação:
 *
 *   condição 1 (todo domínio do buscado está no título)  ->  tokens @> :dominio
 *   condição 2 (ao menos uma função da mesma classe)     ->  classes && :classes
 *
 * `tokensDeFamilia` guarda as duas formas de cada token (plural e singular),
 * exatamente como `cargoBateNoTitulo` monta o conjunto do título; a busca
 * consulta pela forma singular. Sem isso o `@>` erraria em "vendas"/"venda".
 */
export function tokensDeFamilia(titulo: string): string[] {
  const nucleo = decompor(titulo);
  const todos = [
    ...nucleo.dominio,
    ...nucleo.funcoes.map((f) => f.token),
    ...nucleo.senioridade,
  ];

  const conjunto = new Set<string>();
  for (const token of todos) {
    for (const forma of chaves(token)) conjunto.add(forma);
  }
  return [...conjunto];
}

/** Classes de função presentes no título. Vazio quando não há função reconhecida. */
export function classesDeFamilia(titulo: string): ClasseFuncao[] {
  return [...new Set(decompor(titulo).funcoes.map((f) => f.classe))];
}

export interface FiltroDeFamilia {
  /** Tokens que o título PRECISA conter. Forma singular, para casar com `tokensDeFamilia`. */
  dominio: string[];
  /** Classes aceitas. Vazio significa "não restringe por função". */
  classes: ClasseFuncao[];
}

/** Traduz o cargo digitado pelo usuário nos dois arrays do `WHERE`. */
export function filtroDeFamilia(cargoBuscado: string): FiltroDeFamilia {
  const alvo = decompor(cargoBuscado);
  return {
    dominio: [...new Set(alvo.dominio.map((t) => semPlural(t)))],
    classes: [...new Set(alvo.funcoes.map((f) => f.classe))],
  };
}

/**
 * Flexões de gênero em título de vaga em pt-BR, para a chave de agrupamento.
 *
 * Lista curta e por SUFIXO, não por palavra: "vendedora"->"vendedor",
 * "enfermeira"->"enfermeiro". O que ela deliberadamente NÃO faz é trocar `-a`
 * por `-o` no geral — "analista", "motorista" e "dentista" viram lixo com essa
 * regra, e são cargos comuns.
 */
const FEMININO: Array<[RegExp, string]> = [
  [/eira$/, 'eiro'],
  [/ora$/, 'or'],
  [/aria$/, 'ario'],
  [/ica$/, 'ico'],
];

function semGenero(token: string): string {
  if (token.length < 5) return token;
  for (const [de, para] of FEMININO) {
    if (de.test(token)) return token.replace(de, para);
  }
  return token;
}

/**
 * Chave de agrupamento da DEMANDA. Não é a regra de casamento.
 *
 * Existe por um defeito medido no primeiro uso real: o usuário digitou
 * "Enfermagem", "Enfermeira" e "Enfermeiro" na mesma sessão, e a fila de
 * priorização mostrou três pedidos de uma pessoa cada — uma necessidade
 * fragmentada em três sinais fracos. Como é essa fila que decide onde gastar
 * crédito da Serper, contar errado aqui gasta errado lá.
 *
 * Ela é mais agressiva que `cargoBateNoTitulo` de propósito, e isso é seguro
 * porque ninguém é aprovado ou reprovado por ela: no máximo dois pedidos
 * parecidos viram um só na fila.
 *
 * O que ela NÃO resolve: "enfermagem" continua separado de "enfermeiro". São
 * derivações diferentes — a área e a profissão — e colapsar isso exigiria
 * léxico, que é justamente o que o CLAUDE.md proíbe para regra de cargo.
 */
export function chaveDeFamilia(cargo: string): string {
  const nucleo = decompor(cargo);
  const classes = [...new Set(nucleo.funcoes.map((f) => f.classe))].sort();

  let dominio = [...new Set(nucleo.dominio.map((t) => semGenero(semPlural(t))))].sort();

  // Profissão que é só função ("Vendedor", "Designer") sai de `decompor` com
  // domínio vazio, e a chave viraria a CLASSE inteira — "Vendedor", "SDR" e
  // "Representante" no mesmo balde. Para a fila isso é agressivo demais: são
  // dorks diferentes e coletas diferentes. Nesse caso a própria função vira o
  // domínio.
  if (dominio.length === 0) {
    dominio = [...new Set(nucleo.funcoes.map((f) => semGenero(semPlural(f.token))))].sort();
  }

  return `${dominio.join('-')}|${classes.join('-')}`;
}

/**
 * O cargo sem os termos de senioridade, preservando a ordem das palavras.
 *
 * Existe para a consulta a fontes que casam por SUBSTRING, como a API da Gupy.
 * Medido: `jobName="Senior UX Designer"` devolve 3 itens e nenhum dentro da
 * janela; `jobName="UX Designer"` devolve 7. A senioridade estreita a busca na
 * ORIGEM, antes de `cargoBateNoTitulo` ter o que filtrar — e o casamento já
 * ignora senioridade de propósito, então mandá-la para a fonte é pedir menos
 * pelo mesmo resultado.
 *
 * Preserva a ordem porque casamento por substring depende dela: "administrativo
 * auxiliar" não casa "Auxiliar Administrativo".
 */
export function semSenioridade(cargo: string): string {
  // Opera sobre o texto ORIGINAL, não sobre `tokenizar`. Aquele aplica as
  // variantes lexicais (`dados` -> `data`, `produtos` -> `product`), que servem
  // para COMPARAR e destroem uma busca por substring: "Analista de Dados"
  // viraria "analista de data" e deixaria de casar com o próprio cargo.
  const palavras = cargo.split(/\s+/).filter((p) => p !== '');
  const restantes = palavras.filter((p) => !SENIORIDADES.has(normalizarTexto(p)));
  return (restantes.length > 0 ? restantes : palavras).join(' ').trim();
}
