/**
 * Localização, normalizada em campos consultáveis.
 *
 * O feed promete uma composição específica: presencial e híbrido NA CIDADE do
 * usuário, mais remoto de TODO O BRASIL. Para o Postgres executar isso, a
 * localização precisa deixar de ser texto livre. Hoje ela não é: o classificador
 * grava o que o modelo escreveu, e as 197 linhas em produção trazem 25 grafias
 * diferentes de São Paulo (`São Paulo, SP`, `São Paulo - SP`, `São Paulo/SP`,
 * `São Paulo e Região`, `São Paulo, Brasil`...) mais 42 nulls. Nenhum `WHERE`
 * razoável casa isso.
 *
 * A saída tem três campos, com propósitos separados:
 *
 *   cidadeSlug  chave de igualdade. É ela que o filtro de cidade compara.
 *   uf          sigla, quando o texto permitir. Desempata homônimo.
 *   paisBr      true confirmado Brasil, false confirmado fora, null não deu
 *               para saber. TRÊS estados de propósito: colapsar null em false
 *               esconderia vaga brasileira, e em true deixaria passar a vaga
 *               remota da França que hoje está no banco.
 *
 * A assimetria que importa: o filtro de cidade não precisa saber que "Green
 * Bay" é nos Estados Unidos. Ninguém digita "Green Bay" — a vaga simplesmente
 * não casa e some. Saber o país só importa para o balde REMOTO, onde não há
 * cidade para comparar. Por isso `paisBr` erra para `null` em vez de chutar.
 */

/** As 27 unidades federativas. Conjunto fechado — não é manutenção recorrente. */
const UFS: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

const SIGLAS = new Set(Object.values(UFS));

/** "Brasil" escrito de todo jeito que apareceu no dado. */
const BRASIL = new Set([
  'brasil',
  'brazil',
  'br',
  'todo brasil',
  'todo o brasil',
  'brasil todo',
  // Como anúncio de vaga remota escreve "abrangência nacional". Apareceu em
  // produção na reclassificação de 25/08.
  'territorio nacional',
  'todo o territorio nacional',
  'nacional',
]);

/**
 * Lista curta de marcadores de fora do Brasil, para o caso de UMA parte só
 * ("France"), onde a regra de cauda abaixo não tem o que comparar.
 *
 * Curta de propósito e sem ambição de ser exaustiva: o que ela não pegar cai
 * como `paisBr: null`, e aí quem decide é o portão de local do classificador.
 * Preferir "não sei" a errar o país é a mesma assimetria de `normalizarEmpresa`.
 */
const FORA = new Set([
  'portugal',
  'espanha',
  'spain',
  'france',
  'franca',
  'alemanha',
  'germany',
  'argentina',
  'chile',
  'colombia',
  'mexico',
  'peru',
  'uruguai',
  'uruguay',
  'paraguai',
  'venezuela',
  'estados unidos',
  'united states',
  'usa',
  'eua',
  'canada',
  'reino unido',
  'united kingdom',
  'irlanda',
  'ireland',
  'india',
  'worldwide',
  'anywhere',
  'latam',
  'emea',
]);

/** Sufixos que descrevem abrangência metropolitana, não outra cidade. */
const SUFIXO_REGIAO =
  /\s*(e\s+regi[ãa]o|e\s+arredores|metropolitan\s+area|and\s+surrounding\s+area)\s*$/i;

export type Modelo = 'remoto' | 'hibrido' | 'presencial';

export interface LocalNormalizado {
  cidadeSlug: string | null;
  uf: string | null;
  /** true = Brasil confirmado, false = fora confirmado, null = não deu para saber. */
  paisBr: boolean | null;
}

const VAZIO: LocalNormalizado = { cidadeSlug: null, uf: null, paisBr: null };

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** Forma de comparação: minúscula, sem acento, espaço único. */
function chave(texto: string): string {
  return semAcento(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Slug de cidade. É a chave de igualdade do filtro, então a mesma função
 * precisa rodar nos dois lados: no que o classificador grava e no que o usuário
 * digita. Duas normalizações diferentes fariam o filtro discordar do dado.
 */
export function slugCidade(bruto: string): string {
  return chave(bruto).replace(/\s+/g, '-');
}

/** Sigla da UF a partir da sigla ou do nome por extenso. */
export function ufDe(bruto: string): string | null {
  const k = chave(bruto);
  if (k.length === 2 && SIGLAS.has(k.toUpperCase())) return k.toUpperCase();
  return UFS[k] ?? null;
}

/**
 * Quebra a localização nas partes que os anúncios usam: vírgula, barra, hífen
 * e travessão. "Vila Mariana - São Paulo/SP" vira três partes.
 */
function partes(bruto: string): string[] {
  return bruto
    .replace(SUFIXO_REGIAO, '')
    // "Jacareí-SP" não tem espaço em volta do hífen e chegava inteiro como
    // cidade. Só separa quando o que vem depois É uma sigla de UF no fim da
    // string: hífen genérico partiria nome composto de cidade.
    .replace(/-\s*([A-Za-z]{2})\s*$/, (todo, sigla: string) =>
      ufDe(sigla) ? `, ${sigla}` : todo,
    )
    .split(/[,/|]|\s[-–—]\s/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/**
 * Decompõe a localização escrita pelo classificador.
 *
 * Regra da cauda: em anúncio brasileiro a última parte é quase sempre o
 * marcador de país ou a UF ("São Paulo, SP", "Osasco, São Paulo, Brazil"). Se
 * há duas partes ou mais e a cauda NÃO é marcador brasileiro, é forte indício
 * de que a vaga é de fora — foi assim que "Green Bay, Wisconsin" entrou no
 * banco. Com uma parte só não há cauda para comparar, e só a lista curta de
 * `FORA` decide; o resto fica `null`.
 */
export function normalizarLocal(bruto: string | null | undefined): LocalNormalizado {
  if (!bruto) return VAZIO;

  const pedacos = partes(bruto);
  if (pedacos.length === 0) return VAZIO;

  const ehSigla = (p: string) => chave(p).length === 2 && ufDe(p) !== null;
  /**
   * A sigla é o que desambigua cidade de estado quando os dois têm o mesmo
   * nome. Com "São Paulo/SP" a sigla já ocupa o papel de estado, então
   * "São Paulo" só pode ser a cidade — e "Vila Mariana" é bairro. Sem sigla,
   * em "Osasco, São Paulo", quem ocupa o papel de estado é o nome por extenso,
   * e a cidade é Osasco. Mesma forma, papéis diferentes.
   */
  const temSigla = pedacos.some(ehSigla);

  let paisBr: boolean | null = null;
  let uf: string | null = null;
  const candidatos: string[] = [];

  pedacos.forEach((pedaco, indice) => {
    const k = chave(pedaco);
    if (BRASIL.has(k)) {
      paisBr = true;
      return;
    }
    if (FORA.has(k)) {
      paisBr = false;
      return;
    }
    const sigla = ufDe(pedaco);
    if (sigla) {
      uf = sigla;
      paisBr = true;
      // Sigla nunca é cidade. Nome de estado por extenso só deixa de ser
      // candidato quando é ele que está fazendo papel de estado — última parte
      // e sem sigla no endereço.
      const ehOEstado =
        ehSigla(pedaco) || (!temSigla && pedacos.length > 1 && indice === pedacos.length - 1);
      if (!ehOEstado) candidatos.push(pedaco);
      return;
    }
    candidatos.push(pedaco);
  });

  // Com sigla, a cidade é a parte colada nela ("Vila Mariana – São Paulo/SP");
  // sem sigla, é a primeira ("Osasco, São Paulo", "Green Bay, Wisconsin").
  const cidade = temSigla
    ? (candidatos[candidatos.length - 1] ?? null)
    : (candidatos[0] ?? null);

  if (paisBr === null && pedacos.length >= 2) {
    // Cauda não brasileira em endereço de duas partes ou mais: "Green Bay,
    // Wisconsin" tem a forma de endereço completo, e a cauda não é do Brasil.
    const cauda = pedacos[pedacos.length - 1]!;
    if (ufDe(cauda) === null && !BRASIL.has(chave(cauda))) paisBr = false;
  }

  return {
    cidadeSlug: cidade ? slugCidade(cidade) : null,
    uf,
    paisBr,
  };
}

/**
 * Modelo de trabalho a partir do texto, quando o modelo de linguagem não disse.
 *
 * Existe porque `modelo` está null em 114 das 197 linhas gravadas (58%) — e sem
 * modelo a composição do feed (presencial/híbrido na cidade + remoto no Brasil)
 * não é executável. O sinal está escrito no título com frequência: "Vaga Home
 * Office:", "[100% remoto]", "(Híbrida em BH)", "Analista de Dados Pl - São
 * Paulo (Híbrido)".
 *
 * Só decide com termo explícito. A ordem importa: híbrido vence remoto, porque
 * "Híbrido ou Remoto" é oferta de híbrido; presencial vem por último por ser o
 * termo mais raro em título.
 */
export function modeloDoTexto(...textos: Array<string | null | undefined>): Modelo | null {
  const alvo = chave(textos.filter(Boolean).join(' '));
  if (alvo === '') return null;

  if (/\bhibrid[oa]s?\b|\bhybrid\b/.test(alvo)) return 'hibrido';
  if (/\bremot[oa]s?\b|\bremote\b|\bhome office\b|\bteletrabalho\b|\banywhere\b/.test(alvo)) {
    return 'remoto';
  }
  if (/\bpresencial\b|\bon site\b|\bonsite\b/.test(alvo)) return 'presencial';
  return null;
}
