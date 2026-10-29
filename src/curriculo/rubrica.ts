/**
 * A rubrica de 100 pontos do contexto de currículo (seção 11), e as partes da
 * nota que o CÓDIGO calcula.
 *
 * O Pedro decidiu em 28/10 que quem dá a nota é o LLM. Ele dá — critério a
 * critério, com a observação junto —, e a soma é feita aqui. Duas exceções, as
 * duas porque o modelo não teria como acertar:
 *
 *   A. Formato e extração: o LLM recebe texto e não vê coluna, tabela, imagem
 *      nem cabeçalho do editor. Sai dos sinais do arquivo.
 *   C. Requisitos essenciais: o LLM classifica CADA requisito (demonstrado, sem
 *      contexto, ausente); a pontuação é a proporção, como a rubrica define.
 *      Assim a pessoa vê a lista que produziu os 25 pontos, e uma oscilação do
 *      modelo aparece como um requisito que mudou de status, não como um
 *      número que mudou sem explicação (achados 11 e 23).
 */
import type {
  Alerta,
  Extracao,
  Faixa,
  IdCriterio,
  NotaDeCriterio,
  Requisito,
} from './tipos.ts';

/** `descricao` é para quem lê o resultado; o que o LLM avalia está em `prompt.ts`. */
export const CRITERIOS: Record<IdCriterio, { nome: string; maximo: number; pilar: string; descricao: string }> = {
  A: {
    nome: 'Formato e extração',
    maximo: 15,
    pilar: 'Legibilidade técnica',
    descricao:
      'Se um sistema consegue ler o arquivo na ordem certa. Colunas, tabelas, caixas de texto, imagens e contato no cabeçalho do editor costumam embaralhar ou sumir na leitura.',
  },
  B: {
    nome: 'Estrutura e seções',
    maximo: 10,
    pilar: 'Legibilidade técnica',
    descricao:
      'Se as seções esperadas estão lá (contato, resumo, experiência, formação, competências) com títulos que sistemas reconhecem, e numa ordem que faz sentido para o seu perfil.',
  },
  C: {
    nome: 'Requisitos essenciais demonstrados',
    maximo: 25,
    pilar: 'Aderência',
    descricao:
      'Quantos requisitos obrigatórios da vaga, ou do cargo, aparecem usados de verdade nas suas experiências. Só listar em competências vale metade.',
  },
  D: {
    nome: 'Desejáveis, variações e distribuição',
    maximo: 10,
    pilar: 'Aderência',
    descricao:
      'Se os diferenciais aparecem, se o termo exato da vaga está escrito ao menos uma vez, se siglas vêm com o nome por extenso e se o essencial aparece em mais de uma seção.',
  },
  E: {
    nome: 'Título e resumo',
    maximo: 10,
    pilar: 'Aderência',
    descricao:
      'Se o título profissional bate com o cargo que você busca e se o resumo diz, em poucas linhas, quem você é, há quanto tempo e no que é forte.',
  },
  F: {
    nome: 'Evidências nas experiências',
    maximo: 20,
    pilar: 'Leitura humana',
    descricao:
      'Se cada experiência mostra o que você fez, com que ferramenta e com que resultado ou escala, em vez de só listar responsabilidades.',
  },
  G: {
    nome: 'Formação, certificações e idiomas',
    maximo: 5,
    pilar: 'Leitura humana',
    descricao:
      'Se a formação tem grau e situação claros, se cursos livres estão separados da graduação, se certificações têm emissor e ano e se idiomas têm nível.',
  },
  H: {
    nome: 'Clareza e linguagem',
    maximo: 5,
    pilar: 'Leitura humana',
    descricao:
      'Ortografia, frases curtas, tempo verbal consistente e ausência de clichês como "proativo" e "dinâmico".',
  },
};

export const PILARES = ['Legibilidade técnica', 'Aderência', 'Leitura humana'] as const;

const ANO = '(?:19|20)\\d{2}';
const MES = '(?:jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-zç]*\\.?';
const DATA = `(\\b\\d{1,2}\\/${ANO}\\b|\\b${MES}(?:\\s+de)?[\\s/]*${ANO}\\b|\\b${ANO}\\b)`;
const INTERVALO = new RegExp(
  `${DATA}\\s*(?:[-–—]|\\ba\\b|\\baté\\b|\\bto\\b)\\s*(?:${DATA}|atual|atualmente|presente|hoje|o momento|current|present)`,
  'gi',
);

function familia(data: string): string {
  if (/^\d{1,2}\//.test(data)) return 'mm/aaaa';
  if (/^\d{4}$/.test(data)) return 'aaaa';
  return 'mês por extenso';
}

/** Formatos de data usados nos intervalos de experiência e formação. */
export function formatosDeData(texto: string): string[] {
  const vistos = new Set<string>();
  for (const m of texto.matchAll(INTERVALO)) {
    if (m[1]) vistos.add(familia(m[1]));
    if (m[2]) vistos.add(familia(m[2]));
  }
  return [...vistos];
}

/** Critério A, pelos sinais do arquivo. Texto colado não tem formato para medir. */
export function pontuarFormato(extracao: Extracao): { criterio: NotaDeCriterio; alertas: Alerta[] } {
  const { sinais, texto } = extracao;
  const base = { id: 'A' as const, nome: CRITERIOS.A.nome, maximo: CRITERIOS.A.maximo };
  const alertas: Alerta[] = [];

  if (!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(texto)) {
    alertas.push({ tipo: 'extracao', texto: 'Não encontramos e-mail no texto. Sem ele, o recrutador não tem como responder.' });
  }

  if (sinais.tipo === 'texto') {
    return {
      criterio: { ...base, pontos: 0, avaliado: false, observacao: 'Não avaliado: texto colado não mostra o layout do arquivo.' },
      alertas,
    };
  }

  if (sinais.semTexto) {
    alertas.push({
      tipo: 'extracao',
      texto: 'O arquivo quase não tem texto selecionável: provavelmente é imagem ou escaneado. Um ATS lê pouco ou nada dele.',
    });
    return {
      criterio: { ...base, pontos: 0, avaliado: true, observacao: 'Sem texto selecionável.' },
      alertas,
    };
  }

  const problemas: Array<[number, string]> = [];
  if (sinais.colunas) problemas.push([5, 'layout em colunas: o sistema pode misturar a ordem do texto']);
  if (sinais.contatoSoNoCabecalho) problemas.push([4, 'contato só no cabeçalho/rodapé do editor, que vários sistemas ignoram']);
  if (sinais.tabelas > 0) problemas.push([3, `${sinais.tabelas === 1 ? 'uma tabela' : `${sinais.tabelas} tabelas`} organizando o conteúdo`]);
  if (sinais.caixasDeTexto > 0) problemas.push([3, 'texto dentro de caixa de texto']);
  if (sinais.imagens > 0) problemas.push([2, `${sinais.imagens === 1 ? 'uma imagem' : `${sinais.imagens} imagens`} (foto, ícone ou gráfico)`]);
  if (sinais.paginas !== null && sinais.paginas > 2) problemas.push([2, `${sinais.paginas} páginas; a referência é até 2`]);
  // Ano solto não conta: "Concluído em 2019" e "2015 – 2019" na formação ao
  // lado de MM/AAAA na experiência é exatamente o que a rubrica recomenda.
  const datas = formatosDeData(texto).filter((f) => f !== 'aaaa');
  if (datas.length > 1) problemas.push([2, `datas em formatos diferentes (${datas.join(', ')})`]);

  const pontos = Math.max(0, base.maximo - problemas.reduce((s, [p]) => s + p, 0));
  const observacao =
    problemas.length === 0
      ? 'Uma coluna, texto selecionável, sem elemento de risco detectado no arquivo.'
      : problemas.map(([, t]) => t).join('; ').replace(/^./, (c) => c.toUpperCase()) + '.';

  return { criterio: { ...base, pontos, avaliado: true, observacao }, alertas };
}

/** Critério C: proporção dos essenciais demonstrados; sem contexto vale meio. */
export function pontuarRequisitos(requisitos: Requisito[]): NotaDeCriterio {
  const base = { id: 'C' as const, nome: CRITERIOS.C.nome, maximo: CRITERIOS.C.maximo };
  const essenciais = requisitos.filter((r) => r.essencial);
  const contados = essenciais.length > 0 ? essenciais : requisitos;
  if (contados.length === 0) {
    return { ...base, pontos: 0, avaliado: false, observacao: 'Nenhum requisito identificado para comparar.' };
  }
  const demonstrados = contados.filter((r) => r.status === 'demonstrado').length;
  const semContexto = contados.filter((r) => r.status === 'sem_contexto').length;
  const pontos = Math.round((base.maximo * (demonstrados + 0.5 * semContexto)) / contados.length);
  const tipo = essenciais.length > 0 ? 'essenciais' : 'requisitos';
  return {
    ...base,
    pontos,
    avaliado: true,
    observacao: `${demonstrados} de ${contados.length} ${tipo} com evidência; ${semContexto} citados sem contexto.`,
  };
}

/** Nota de 0 a 100 sobre os critérios avaliados. */
export function totalizar(criterios: NotaDeCriterio[]): number {
  const avaliados = criterios.filter((c) => c.avaliado);
  const maximo = avaliados.reduce((s, c) => s + c.maximo, 0);
  if (maximo === 0) return 0;
  return Math.round((100 * avaliados.reduce((s, c) => s + c.pontos, 0)) / maximo);
}

export function faixa(nota: number): Faixa {
  if (nota >= 85) return 'Muito bom';
  if (nota >= 70) return 'Bom, com ajustes pontuais';
  if (nota >= 50) return 'Lacunas relevantes';
  return 'Recomenda-se reestruturação';
}
