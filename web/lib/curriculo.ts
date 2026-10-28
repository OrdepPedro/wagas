/**
 * Do arquivo enviado ao texto + sinais de layout. Só servidor.
 *
 * O PDF passa pelo pdf.js (via `unpdf`, a única dependência nova do medidor);
 * o DOCX, pelo leitor sem dependência de `src/curriculo/docx.ts`. Os dois
 * terminam no mesmo `Extracao`, e daí em diante o caminho é um só.
 *
 * Nada aqui grava o arquivo: ele chega como `File`, vira bytes em memória e
 * some com a requisição.
 */
import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';

import { ArquivoIlegivel, extrairDocx } from '../../src/curriculo/docx.ts';
import { analisarPdf, type ItemPdf, type PaginaPdf } from '../../src/curriculo/pdf.ts';
import type { Extracao } from '../../src/curriculo/tipos.ts';

export const MAX_BYTES = 5 * 1024 * 1024;
/** Currículo com mais que isso é catálogo; ler tudo só gastaria tempo de servidor. */
const MAX_PAGINAS = 6;

export { ArquivoIlegivel };

async function extrairPdf(bytes: Uint8Array): Promise<Extracao> {
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new ArquivoIlegivel('não consegui abrir o PDF (protegido por senha ou corrompido)');
  }
  const { OPS } = await getResolvedPDFJS();
  const imagem = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);

  const paginas: PaginaPdf[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGINAS); n++) {
    const pagina = await pdf.getPage(n);
    const { width } = pagina.getViewport({ scale: 1 });
    const conteudo = await pagina.getTextContent();
    const itens: ItemPdf[] = [];
    for (const i of conteudo.items) {
      if (!('str' in i)) continue;
      itens.push({ x: i.transform[4], y: i.transform[5], largura: i.width, texto: i.str, fimDeLinha: i.hasEOL });
    }
    const operacoes = await pagina.getOperatorList();
    paginas.push({ largura: width, itens, imagens: operacoes.fnArray.filter((op) => imagem.has(op)).length });
  }

  const extracao = analisarPdf(paginas);
  // O sinal de páginas é do documento inteiro, não só do que foi lido.
  return { ...extracao, sinais: { ...extracao.sinais, paginas: pdf.numPages } };
}

export async function extrairArquivo(arquivo: File): Promise<Extracao> {
  if (arquivo.size > MAX_BYTES) throw new ArquivoIlegivel('o arquivo passa de 5 MB');
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const nome = arquivo.name.toLowerCase();

  // Pela assinatura, não pela extensão: PDF começa com "%PDF", DOCX é zip ("PK").
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return extrairPdf(bytes);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return extrairDocx(bytes);
  if (nome.endsWith('.doc')) throw new ArquivoIlegivel('o formato .doc antigo não é lido; salve como .docx ou PDF');
  throw new ArquivoIlegivel('envie PDF ou DOCX');
}
