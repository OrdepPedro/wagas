/**
 * Sinais de layout de um PDF, a partir dos itens de texto posicionados.
 *
 * A leitura do arquivo em si (pdf.js, via `unpdf`) mora em `web/lib`, que é
 * quem tem a dependência. Aqui fica só a parte que dá para testar sem PDF:
 * dado onde cada pedaço de texto está na página, o currículo é de uma coluna?
 *
 * PDF não tem "tabela" nem "cabeçalho do editor": é tinta posicionada. Coluna
 * é o único risco de extração que dá para inferir com alguma segurança, e ela
 * aparece de dois jeitos:
 *
 *   1. Linhas DIVIDIDAS: a mesma altura tem texto à esquerda e, depois de um
 *      vão largo, texto começando no meio da página (duas colunas alinhadas).
 *   2. Duas MARGENS: muitas linhas começam na margem esquerda e muitas outras
 *      começam bem mais à direita (barra lateral com alturas desencontradas).
 *
 * Data alinhada à direita na linha do cargo ("Analista … 01/2020 – Atual") é o
 * falso positivo óbvio, e é por isso que o lado direito só conta quando começa
 * entre 20% e 65% da largura.
 */
import type { Extracao } from './tipos.ts';

export interface ItemPdf {
  x: number;
  y: number;
  largura: number;
  texto: string;
  fimDeLinha: boolean;
}

export interface PaginaPdf {
  largura: number;
  itens: ItemPdf[];
  imagens: number;
}

interface Linha {
  inicio: number;
  itens: ItemPdf[];
}

function linhas(pagina: PaginaPdf): Linha[] {
  const porAltura = new Map<number, ItemPdf[]>();
  for (const item of pagina.itens) {
    if (item.texto.trim() === '') continue;
    const chave = Math.round(item.y / 2);
    const grupo = porAltura.get(chave) ?? [];
    grupo.push(item);
    porAltura.set(chave, grupo);
  }
  return [...porAltura.values()].map((itens) => {
    itens.sort((a, b) => a.x - b.x);
    return { inicio: itens[0]!.x, itens };
  });
}

/** A página parece ter duas colunas de texto? */
export function paginaEmColunas(pagina: PaginaPdf): boolean {
  const ls = linhas(pagina);
  if (ls.length < 8 || pagina.largura <= 0) return false;
  const L = pagina.largura;
  const margem = Math.min(...ls.map((l) => l.inicio));
  const meioValido = (x: number) => x > margem + 0.2 * L && x < 0.65 * L;

  // 1. Linhas divididas por um vão largo, com o lado direito começando no meio.
  const cortes: number[] = [];
  for (const l of ls) {
    for (let i = 0; i < l.itens.length - 1; i++) {
      const a = l.itens[i]!;
      const b = l.itens[i + 1]!;
      if (b.x - (a.x + a.largura) > 0.06 * L && meioValido(b.x)) {
        cortes.push(b.x / L);
        break;
      }
    }
  }
  if (cortes.length >= 6 && cortes.length >= 0.3 * ls.length) {
    cortes.sort((a, b) => a - b);
    const mediana = cortes[Math.floor(cortes.length / 2)]!;
    const alinhados = cortes.filter((c) => Math.abs(c - mediana) < 0.05).length;
    if (alinhados >= 0.6 * cortes.length) return true;
  }

  // 2. Duas margens esquerdas, cada uma com bastante linha.
  const naMargem = ls.filter((l) => l.inicio < margem + 0.08 * L).length;
  const deslocadas = ls.filter((l) => meioValido(l.inicio)).length;
  return naMargem >= 0.25 * ls.length && deslocadas >= 0.25 * ls.length && deslocadas >= 5;
}

export function textoDasPaginas(paginas: PaginaPdf[]): string {
  return paginas
    .map((p) =>
      p.itens
        .map((i) => i.texto + (i.fimDeLinha ? '\n' : ''))
        .join('')
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n')
        .trim(),
    )
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function analisarPdf(paginas: PaginaPdf[]): Extracao {
  const texto = textoDasPaginas(paginas);
  const visiveis = texto.replace(/\s/g, '').length;
  return {
    texto,
    sinais: {
      tipo: 'pdf',
      paginas: paginas.length,
      caracteres: texto.length,
      // Menos de 150 caracteres por página é imagem com, no máximo, um nome.
      semTexto: visiveis < 150 * Math.max(paginas.length, 1),
      colunas: paginas.some(paginaEmColunas),
      tabelas: 0,
      caixasDeTexto: 0,
      imagens: paginas.reduce((s, p) => s + p.imagens, 0),
      contatoSoNoCabecalho: false,
    },
  };
}
