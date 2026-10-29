/**
 * Leitura de DOCX sem dependência.
 *
 * DOCX é um zip de XML. Uma biblioteca como o mammoth devolveria o texto, mas
 * jogaria fora justamente o que o critério A precisa ver: tabela (`<w:tbl>`),
 * caixa de texto (`<w:txbxContent>`), seção em colunas (`<w:cols w:num>`),
 * imagem (`word/media/`) e o que mora no cabeçalho do editor (`header*.xml`).
 * São esses os elementos que a Gupy e o Greenhouse documentam como risco de
 * extração. Ler o XML cru dá o texto e os sinais na mesma passada.
 *
 * O leitor de zip cobre o que o Word, o Google Docs e o LibreOffice gravam:
 * método 0 (armazenado) e 8 (deflate), sem zip64. Arquivo fora disso é
 * recusado com erro, nunca lido pela metade.
 */
import { inflateRawSync } from 'node:zlib';

import type { Extracao } from './tipos.ts';

export class ArquivoIlegivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ArquivoIlegivel';
  }
}

/** Teto por entrada descomprimida: um currículo não chega perto, um zip-bomba sim. */
const MAX_DESCOMPRIMIDO = 20 * 1024 * 1024;

interface EntradaZip {
  nome: string;
  metodo: number;
  inicio: number;
  tamanho: number;
}

/** Lista as entradas pelo diretório central, sem descomprimir nada. */
export function listarZip(buf: Uint8Array): Map<string, EntradaZip> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ArquivoIlegivel('o arquivo não é um DOCX válido');

  const total = dv.getUint16(fim + 10, true);
  let p = dv.getUint32(fim + 16, true);
  const entradas = new Map<string, EntradaZip>();
  const nomes = new TextDecoder();

  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) {
      throw new ArquivoIlegivel('diretório do DOCX corrompido');
    }
    const metodo = dv.getUint16(p + 10, true);
    const tamanho = dv.getUint32(p + 20, true);
    const tamNome = dv.getUint16(p + 28, true);
    const tamExtra = dv.getUint16(p + 30, true);
    const tamComentario = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nome = nomes.decode(buf.subarray(p + 46, p + 46 + tamNome));
    p += 46 + tamNome + tamExtra + tamComentario;

    // O tamanho do nome e do extra no cabeçalho LOCAL pode diferir do central.
    if (local + 30 > buf.length) throw new ArquivoIlegivel('entrada do DOCX fora do arquivo');
    const inicio = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    entradas.set(nome, { nome, metodo, inicio, tamanho });
  }
  return entradas;
}

function lerEntrada(buf: Uint8Array, entrada: EntradaZip): string {
  const dados = buf.subarray(entrada.inicio, entrada.inicio + entrada.tamanho);
  let bruto: Uint8Array;
  if (entrada.metodo === 0) bruto = dados;
  else if (entrada.metodo === 8) {
    try {
      bruto = inflateRawSync(dados, { maxOutputLength: MAX_DESCOMPRIMIDO });
    } catch {
      throw new ArquivoIlegivel(`não consegui descomprimir ${entrada.nome}`);
    }
  } else throw new ArquivoIlegivel(`compressão ${entrada.metodo} não suportada em ${entrada.nome}`);
  return new TextDecoder().decode(bruto);
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (inteiro, corpo: string) => {
    if (corpo[0] === '#') {
      const codigo = corpo[1] === 'x' || corpo[1] === 'X' ? parseInt(corpo.slice(2), 16) : parseInt(corpo.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteiro;
    }
    return ENTIDADES[corpo] ?? inteiro;
  });
}

/**
 * Texto de um XML do Word, parágrafo por linha.
 *
 * O `mc:Fallback` sai antes: o Word grava a caixa de texto duas vezes (DrawingML
 * e VML de reserva), e sem isso todo texto de caixa apareceria duplicado.
 * `<w:tab/>` sem atributo é tabulação no texto; com atributo é definição de
 * parada de tabulação no estilo, e não vira caractere.
 */
export function textoDoXml(xml: string): string {
  const limpo = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
  let saida = '';
  for (const m of limpo.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g)) {
    if (m[1] !== undefined) saida += decodificar(m[1]);
    else if (m[0] === '<w:tab/>') saida += '\t';
    else saida += '\n';
  }
  return saida
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CONTATO = /[\w.+-]+@[\w-]+\.[\w.-]+|\(?\b\d{2}\)?\s?9?\d{4}[-\s.]?\d{4}\b/;

export function temContato(texto: string): boolean {
  return CONTATO.test(texto);
}

export function extrairDocx(buf: Uint8Array): Extracao {
  const entradas = listarZip(buf);
  const documento = entradas.get('word/document.xml');
  if (!documento) throw new ArquivoIlegivel('o arquivo não tem o corpo de um documento do Word');

  const xml = lerEntrada(buf, documento);
  const corpo = textoDoXml(xml);

  const margens = [...entradas.keys()]
    .filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))
    .map((n) => textoDoXml(lerEntrada(buf, entradas.get(n)!)))
    .filter((t) => t !== '');
  const textoMargens = margens.join('\n');

  const app = entradas.get('docProps/app.xml');
  const paginas = app ? Number(/<Pages>(\d+)<\/Pages>/.exec(lerEntrada(buf, app))?.[1]) : NaN;

  const colunas = [...xml.matchAll(/<w:cols\b[^>]*\bw:num="(\d+)"/g)].some((m) => Number(m[1]) > 1);

  // O que está só no cabeçalho do editor vai junto para o LLM, marcado: a
  // pessoa TEM contato, e o risco de o ATS não ler é cobrado no critério A, não
  // de novo como "contato ausente" na estrutura.
  const texto = textoMargens ? `[Cabeçalho/rodapé do editor]\n${textoMargens}\n\n${corpo}` : corpo;

  return {
    texto,
    sinais: {
      tipo: 'docx',
      paginas: Number.isFinite(paginas) && paginas > 0 ? paginas : null,
      caracteres: corpo.length,
      semTexto: corpo.replace(/\s/g, '').length < 200,
      colunas,
      tabelas: (xml.match(/<w:tbl>/g) ?? []).length,
      caixasDeTexto: (xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '').match(/<w:txbxContent\b/g) ?? []).length,
      imagens: [...entradas.keys()].filter((n) => n.startsWith('word/media/')).length,
      contatoSoNoCabecalho: temContato(textoMargens) && !temContato(corpo),
    },
  };
}
