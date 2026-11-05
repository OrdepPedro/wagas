/**
 * O CV adaptado como PDF, de uma coluna.
 *
 * Uma coluna de propósito: é o layout que os ATSs leem sem embaralhar (Gupy,
 * InfoJobs e companhia extraem texto do PDF), e o candidato vai subir este
 * arquivo exatamente neles. Duas colunas bonitas que saem embaralhadas no ATS
 * desfazem o trabalho da adaptação.
 *
 * Fontes padrão do PDF (Helvetica), sem arquivo de fonte embutido: cobrem todo
 * o português (WinAnsi) e deixam o arquivo com poucos KB. O que a codificação
 * não cobre — emoji, seta, aspas exóticas — é trocado ou removido em
 * `paraWinAnsi`, porque um caractere fora dela derruba a geração inteira.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CurriculoAdaptado } from '../../src/curriculo/adaptar.ts';

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 50;
const LARGURA = A4[0] - 2 * MARGEM;
const TINTA = rgb(0.1, 0.1, 0.12);
const CINZA = rgb(0.4, 0.4, 0.45);

const TROCAS: Record<string, string> = {
  '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': '-', '✔': '-', '★': '*', '▪': '•', '●': '•', '◦': '•',
  ' ': ' ', '​': '', '−': '-',
};

export function paraWinAnsi(texto: string, fonte: PDFFont): string {
  const aceitos = new Set(fonte.getCharacterSet());
  let saida = '';
  for (const c of texto.normalize('NFC')) {
    if (aceitos.has(c.codePointAt(0)!)) saida += c;
    else if (c in TROCAS) saida += TROCAS[c];
    // o resto (emoji, ideogramas) sai — melhor que derrubar o PDF
  }
  return saida;
}

class Escritor {
  #doc: PDFDocument;
  #pagina!: PDFPage;
  #y = 0;
  regular: PDFFont;
  negrito: PDFFont;

  constructor(doc: PDFDocument, regular: PDFFont, negrito: PDFFont) {
    this.#doc = doc;
    this.regular = regular;
    this.negrito = negrito;
    this.#novaPagina();
  }

  #novaPagina() {
    this.#pagina = this.#doc.addPage(A4);
    this.#y = A4[1] - MARGEM;
  }

  #garantir(altura: number) {
    if (this.#y - altura < MARGEM) this.#novaPagina();
  }

  /** Quebra por palavra; palavra maior que a linha (URL) é quebrada por caractere. */
  #linhas(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
    const linhas: string[] = [];
    let atual = '';
    for (const palavra of texto.split(/\s+/).filter(Boolean)) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
        atual = tentativa;
        continue;
      }
      if (atual) linhas.push(atual);
      atual = palavra;
      while (fonte.widthOfTextAtSize(atual, tamanho) > largura && atual.length > 1) {
        let corte = atual.length - 1;
        while (corte > 1 && fonte.widthOfTextAtSize(atual.slice(0, corte), tamanho) > largura) corte--;
        linhas.push(atual.slice(0, corte));
        atual = atual.slice(corte);
      }
    }
    if (atual) linhas.push(atual);
    return linhas;
  }

  texto(bruto: string, opts: { tamanho?: number; fonte?: PDFFont; cor?: typeof TINTA; recuo?: number; marcador?: string } = {}) {
    const tamanho = opts.tamanho ?? 10;
    const fonte = opts.fonte ?? this.regular;
    const recuo = opts.recuo ?? 0;
    const altura = tamanho * 1.35;
    const texto = paraWinAnsi(bruto, fonte);
    const linhas = this.#linhas(texto, fonte, tamanho, LARGURA - recuo);

    linhas.forEach((linha, i) => {
      this.#garantir(altura);
      this.#y -= altura;
      if (i === 0 && opts.marcador) {
        this.#pagina.drawText(opts.marcador, { x: MARGEM + recuo - 10, y: this.#y, size: tamanho, font: fonte, color: opts.cor ?? TINTA });
      }
      this.#pagina.drawText(linha, { x: MARGEM + recuo, y: this.#y, size: tamanho, font: fonte, color: opts.cor ?? TINTA });
    });
  }

  espaco(pts: number) {
    this.#y -= pts;
  }

  secao(titulo: string) {
    // Título não fica órfão no pé da página.
    this.#garantir(40);
    this.espaco(12);
    this.texto(titulo.toUpperCase(), { tamanho: 10.5, fonte: this.negrito });
    this.espaco(3);
    this.#pagina.drawLine({
      start: { x: MARGEM, y: this.#y },
      end: { x: MARGEM + LARGURA, y: this.#y },
      thickness: 0.6,
      color: CINZA,
    });
    this.espaco(4);
  }
}

export async function gerarPdf(cv: CurriculoAdaptado): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Currículo — ${cv.nome}`);
  doc.setAuthor(cv.nome);
  doc.setProducer('wagas');
  doc.setCreator('wagas');

  const e = new Escritor(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
  );

  e.texto(cv.nome, { tamanho: 20, fonte: e.negrito });
  if (cv.titulo) {
    e.espaco(2);
    e.texto(cv.titulo, { tamanho: 11.5 });
  }
  if (cv.contato.length > 0) {
    e.espaco(2);
    e.texto(cv.contato.join('  ·  '), { tamanho: 9, cor: CINZA });
  }

  if (cv.resumo) {
    e.secao('Resumo');
    e.texto(cv.resumo);
  }

  if (cv.experiencias.length > 0) {
    e.secao('Experiência');
    cv.experiencias.forEach((x, i) => {
      if (i > 0) e.espaco(6);
      e.texto([x.cargo, x.empresa].filter(Boolean).join(' — '), { fonte: e.negrito, tamanho: 10.5 });
      if (x.periodo) e.texto(x.periodo, { tamanho: 9, cor: CINZA });
      for (const item of x.itens) e.texto(item, { recuo: 12, marcador: '•' });
    });
  }

  if (cv.formacao.length > 0) {
    e.secao('Formação');
    for (const f of cv.formacao) {
      e.texto([f.curso, f.instituicao].filter(Boolean).join(' — '), { fonte: e.negrito });
      if (f.periodo) e.texto(f.periodo, { tamanho: 9, cor: CINZA });
    }
  }

  if (cv.habilidades.length > 0) {
    e.secao('Habilidades');
    e.texto(cv.habilidades.join(' · '));
  }
  if (cv.certificacoes.length > 0) {
    e.secao('Certificações');
    for (const c of cv.certificacoes) e.texto(c, { recuo: 12, marcador: '•' });
  }
  if (cv.idiomas.length > 0) {
    e.secao('Idiomas');
    e.texto(cv.idiomas.join(' · '));
  }

  // `mudancas` e `lacunas` NÃO entram no PDF: são para o candidato ler, não para o recrutador.
  return doc.save();
}

/** Nome do arquivo: "curriculo-maria-souza-analista-de-crm.pdf". */
export function nomeDoArquivo(nome: string, cargo: string): string {
  const slug = (s: string) =>
    s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `curriculo-${[slug(nome), slug(cargo)].filter(Boolean).join('-').slice(0, 80)}.pdf`;
}
