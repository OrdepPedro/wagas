import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import type { Provedor } from '../src/classificar/llm.ts';
import { ArquivoIlegivel, extrairDocx, textoDoXml } from '../src/curriculo/docx.ts';
import { CurriculoSemTexto, medirCurriculo } from '../src/curriculo/medir.ts';
import { analisarPdf, paginaEmColunas, type ItemPdf, type PaginaPdf } from '../src/curriculo/pdf.ts';
import { interpretarAvaliacao, montarPrompt, RespostaInvalida } from '../src/curriculo/prompt.ts';
import { faixa, formatosDeData, pontuarFormato, pontuarRequisitos, totalizar } from '../src/curriculo/rubrica.ts';
import type { Extracao, SinaisDoArquivo } from '../src/curriculo/tipos.ts';

/** Zip mínimo (deflate, CRC zerado — o leitor não confere CRC). */
function zip(arquivos: Record<string, string>): Uint8Array {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const nomeBuf = Buffer.from(nome);
    const dados = deflateRawSync(Buffer.from(conteudo));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(conteudo.length, 24);
    central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locais.push(local, nomeBuf, dados);
    centrais.push(central, nomeBuf);
    offset += 30 + nomeBuf.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8);
  fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locais, dir, fim]));
}

const p = (texto: string) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`;
const corpoLongo = Array.from({ length: 12 }, (_, i) => p(`Linha de experiência número ${i} com texto suficiente.`)).join('');
const documento = (miolo: string, extra = '') =>
  `<?xml version="1.0"?><w:document><w:body>${miolo}${extra}</w:body></w:document>`;

describe('textoDoXml', () => {
  it('parágrafo vira linha, tabulação de run vira \\t e entidades são decodificadas', () => {
    const xml = `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="100"/></w:tabs></w:pPr><w:r><w:t>Dados &amp; BI</w:t><w:tab/><w:t xml:space="preserve">01/2020</w:t></w:r></w:p>${p('Segunda')}`;
    assert.equal(textoDoXml(xml), 'Dados & BI\t01/2020\nSegunda');
  });

  it('não duplica o texto da caixa gravado de novo no VML de reserva', () => {
    const xml = `<mc:AlternateContent><mc:Choice><w:txbxContent>${p('Caixa')}</w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent>${p('Caixa')}</w:txbxContent></mc:Fallback></mc:AlternateContent>`;
    assert.equal(textoDoXml(xml), 'Caixa');
  });
});

describe('extrairDocx', () => {
  it('documento limpo: sem sinal de risco', () => {
    const { sinais, texto } = extrairDocx(
      zip({ 'word/document.xml': documento(p('Ana Souza — ana@exemplo.com') + corpoLongo), 'docProps/app.xml': '<Properties><Pages>2</Pages></Properties>' }),
    );
    assert.equal(sinais.paginas, 2);
    assert.equal(sinais.colunas, false);
    assert.equal(sinais.tabelas, 0);
    assert.equal(sinais.semTexto, false);
    assert.equal(sinais.contatoSoNoCabecalho, false);
    assert.match(texto, /^Ana Souza/);
  });

  it('acusa tabela, caixa de texto, colunas, imagem e contato só no cabeçalho', () => {
    const miolo = `<w:tbl><w:tr><w:tc>${p('célula')}</w:tc></w:tr></w:tbl><w:txbxContent>${p('caixa')}</w:txbxContent>${corpoLongo}`;
    const { sinais, texto } = extrairDocx(
      zip({
        'word/document.xml': documento(miolo, '<w:sectPr><w:cols w:space="720" w:num="2"/></w:sectPr>'),
        'word/header1.xml': `<w:hdr>${p('ana@exemplo.com | (31) 99999-0000')}</w:hdr>`,
        'word/media/image1.png': 'x',
      }),
    );
    assert.equal(sinais.tabelas, 1);
    assert.equal(sinais.caixasDeTexto, 1);
    assert.equal(sinais.colunas, true);
    assert.equal(sinais.imagens, 1);
    assert.equal(sinais.contatoSoNoCabecalho, true);
    // O contato vai para o LLM, marcado, para não virar "contato ausente" em dobro.
    assert.match(texto, /^\[Cabeçalho\/rodapé do editor\]\nana@exemplo\.com/);
  });

  it('arquivo que não é zip é recusado, não lido pela metade', () => {
    assert.throws(() => extrairDocx(new TextEncoder().encode('não sou um docx')), ArquivoIlegivel);
  });
});

function item(x: number, y: number, texto: string, largura = texto.length * 5): ItemPdf {
  return { x, y, largura, texto, fimDeLinha: true };
}

describe('paginaEmColunas', () => {
  it('uma coluna com data alinhada à direita não é coluna', () => {
    const itens: ItemPdf[] = [];
    for (let i = 0; i < 20; i++) {
      itens.push({ ...item(50, 800 - i * 14, `Bullet de experiência ${i}`), fimDeLinha: i % 4 !== 0 });
      if (i % 4 === 0) itens.push(item(480, 800 - i * 14, '01/2020 – Atual', 70));
    }
    assert.equal(paginaEmColunas({ largura: 600, itens, imagens: 0 }), false);
  });

  it('barra lateral + coluna principal na mesma altura é coluna', () => {
    const itens: ItemPdf[] = [];
    for (let i = 0; i < 20; i++) {
      itens.push({ ...item(30, 800 - i * 14, 'Python, SQL', 60), fimDeLinha: false });
      itens.push(item(220, 800 - i * 14, `Implementei o pipeline ${i}`));
    }
    assert.equal(paginaEmColunas({ largura: 600, itens, imagens: 0 }), true);
  });

  it('barra lateral com alturas desencontradas também é coluna', () => {
    const itens: ItemPdf[] = [];
    for (let i = 0; i < 12; i++) itens.push(item(30, 800 - i * 20, 'Competência'));
    for (let i = 0; i < 15; i++) itens.push(item(220, 793 - i * 17, `Experiência ${i}`));
    assert.equal(paginaEmColunas({ largura: 600, itens, imagens: 0 }), true);
  });
});

describe('analisarPdf', () => {
  it('PDF escaneado sai como sem texto', () => {
    const pagina: PaginaPdf = { largura: 600, itens: [item(50, 800, 'Ana')], imagens: 1 };
    const { sinais } = analisarPdf([pagina, pagina]);
    assert.equal(sinais.semTexto, true);
    assert.equal(sinais.imagens, 2);
  });
});

const sinais = (s: Partial<SinaisDoArquivo>): SinaisDoArquivo => ({
  tipo: 'pdf',
  paginas: 1,
  caracteres: 3000,
  semTexto: false,
  colunas: false,
  tabelas: 0,
  caixasDeTexto: 0,
  imagens: 0,
  contatoSoNoCabecalho: false,
  ...s,
});
const TEXTO = 'ana@exemplo.com\nAnalista de Dados | Banco X\n01/2020 – Atual\nFormação 2015 – 2019';

describe('formatosDeData', () => {
  it('reconhece família de cada intervalo e ignora telefone', () => {
    assert.deepEqual(formatosDeData('01/2020 – Atual\n03/2018 - 12/2019'), ['mm/aaaa']);
    assert.deepEqual(formatosDeData('jan/2020 – Atual\n2015 – 2019').sort(), ['aaaa', 'mês por extenso']);
    assert.deepEqual(formatosDeData('(31) 9999-8888'), []);
  });
});

describe('pontuarFormato', () => {
  it('arquivo limpo leva 15, e ano solto na formação não é mistura de formato', () => {
    const { criterio } = pontuarFormato({ texto: TEXTO, sinais: sinais({}) });
    assert.equal(criterio.pontos, 15);
  });

  it('desconta cada risco e explica', () => {
    const texto = `${TEXTO}\njan/2017 – dez/2017`;
    const { criterio } = pontuarFormato({ texto, sinais: sinais({ colunas: true, imagens: 1, paginas: 3 }) });
    assert.equal(criterio.pontos, 15 - 5 - 2 - 2 - 2);
    assert.match(criterio.observacao, /colunas/);
    assert.match(criterio.observacao, /3 páginas/);
    assert.match(criterio.observacao, /mm\/aaaa, mês por extenso/);
  });

  it('texto colado fica fora da soma, não com zero', () => {
    const { criterio } = pontuarFormato({ texto: TEXTO, sinais: sinais({ tipo: 'texto', paginas: null }) });
    assert.equal(criterio.avaliado, false);
  });

  it('sem e-mail gera alerta de extração', () => {
    const { alertas } = pontuarFormato({ texto: 'sem contato', sinais: sinais({}) });
    assert.equal(alertas[0]?.tipo, 'extracao');
  });
});

describe('pontuarRequisitos e totalizar', () => {
  it('sem contexto vale meio ponto, e só os essenciais contam quando existem', () => {
    const c = pontuarRequisitos([
      { termo: 'SQL', essencial: true, status: 'demonstrado', grafiaNoCurriculo: null },
      { termo: 'Python', essencial: true, status: 'sem_contexto', grafiaNoCurriculo: null },
      { termo: 'Airflow', essencial: false, status: 'ausente', grafiaNoCurriculo: null },
    ]);
    assert.equal(c.pontos, Math.round((25 * 1.5) / 2));
  });

  it('nota é normalizada sobre o que foi avaliado', () => {
    assert.equal(
      totalizar([
        { id: 'A', nome: '', pontos: 0, maximo: 15, avaliado: false, observacao: '' },
        { id: 'B', nome: '', pontos: 85, maximo: 85, avaliado: true, observacao: '' },
      ]),
      100,
    );
  });

  it('faixas da rubrica', () => {
    assert.equal(faixa(85), 'Muito bom');
    assert.equal(faixa(84), 'Bom, com ajustes pontuais');
    assert.equal(faixa(50), 'Lacunas relevantes');
    assert.equal(faixa(49), 'Recomenda-se reestruturação');
  });
});

const respostaValida = {
  criterios: {
    B: { pontos: 8, observacao: 'ok' },
    D: { pontos: 14, observacao: 'acima do teto' },
    E: { pontos: 7, observacao: 'ok' },
    F: { pontos: 12, observacao: 'ok' },
    G: { pontos: 4, observacao: 'ok' },
    H: { pontos: -1, observacao: 'abaixo do piso' },
  },
  requisitos: [
    { termo: 'SQL', essencial: true, status: 'demonstrado' },
    { termo: 'sql', essencial: true, status: 'ausente' },
    { termo: 'Power BI', essencial: true, status: 'sem_contexto', grafiaNoCurriculo: 'PowerBI' },
    { termo: 'Excel', essencial: false, status: 'inventado' },
  ],
  alertas: [{ tipo: 'privacidade', texto: 'CPF no topo' }, { tipo: 'outro', texto: 'x' }],
  melhorias: ['a', 'b', 'c', 'd', 'e', 'f'],
};

describe('interpretarAvaliacao', () => {
  it('prende os pontos no intervalo de cada critério e limpa o resto', () => {
    const a = interpretarAvaliacao(JSON.stringify(respostaValida));
    assert.equal(a.criterios.D.pontos, 10);
    assert.equal(a.criterios.H.pontos, 0);
    assert.deepEqual(a.requisitos.map((r) => r.termo), ['SQL', 'Power BI']);
    assert.equal(a.requisitos[1]?.grafiaNoCurriculo, 'PowerBI');
    assert.equal(a.alertas.length, 1);
    assert.equal(a.melhorias.length, 5);
  });

  it('critério faltando é erro, não zero', () => {
    const { B: _, ...semB } = respostaValida.criterios;
    assert.throws(() => interpretarAvaliacao(JSON.stringify({ ...respostaValida, criterios: semB })), RespostaInvalida);
  });
});

describe('montarPrompt', () => {
  it('sem vaga, pede os requisitos típicos do cargo', () => {
    assert.match(montarPrompt({ curriculo: 'cv', cargo: 'Enfermeiro', vaga: null }), /requisitos típicos desse cargo/);
  });
  it('com vaga, a vaga entra no prompt', () => {
    assert.match(montarPrompt({ curriculo: 'cv', cargo: 'Enfermeiro', vaga: 'COREN ativo' }), /VAGA\nCOREN ativo/);
  });
});

describe('medirCurriculo', () => {
  const provedor = (resposta: unknown): Provedor => ({ nome: 'falso/modelo', julgar: async () => JSON.stringify(resposta) });
  const extracao: Extracao = { texto: TEXTO, sinais: sinais({}) };

  it('junta A e C do código com o resto do LLM', async () => {
    const r = await medirCurriculo({ extracao, cargo: 'Analista de Dados', vaga: '  ' }, provedor(respostaValida));
    assert.deepEqual(r.criterios.map((c) => c.id), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    assert.equal(r.estimada, true);
    assert.equal(r.modelo, 'falso/modelo');
    const soma = r.criterios.reduce((s, c) => s + c.pontos, 0);
    assert.equal(r.nota, soma);
  });

  it('arquivo sem texto não chama o LLM', async () => {
    let chamou = false;
    const espiao: Provedor = { nome: 'x', julgar: async () => ((chamou = true), '{}') };
    await assert.rejects(
      medirCurriculo({ extracao: { texto: '', sinais: sinais({ semTexto: true }) }, cargo: 'x', vaga: null }, espiao),
      CurriculoSemTexto,
    );
    assert.equal(chamou, false);
  });
});
