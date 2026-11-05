/**
 * Teste ponta a ponta da adaptação, fora do Next: vaga REAL do banco, CV
 * FICTÍCIO, modelo real, PDF gerado e lido de volta.
 *
 * Usa o Groq se houver GROQ_KEY; senão o Gemini — aceitável só porque o CV
 * daqui não é de ninguém. CV de usuário nunca vai para o Gemini gratuito.
 *
 *   node --env-file=.env.local scripts/testar-curriculo.ts [saida.pdf] [--cargo=Analista de Marketing]
 */
import { writeFile } from 'node:fs/promises';
import { ProvedorGemini, ProvedorGroq, type Provedor } from '../../src/classificar/llm.ts';
import {
  interpretarResposta,
  montarPrompt,
  vagaAdaptavel,
  verificarFidelidade,
} from '../../src/curriculo/adaptar.ts';
import { gerarPdf } from '../lib/pdf-curriculo.ts';

const CV_FICTICIO = `Joana Ribeiro Lima
joana.lima@exemplo.com | (11) 98888-7777 | São Paulo, SP | linkedin.com/in/joana-exemplo

Analista de Marketing Pleno — Casa Verde Varejo (mar/2022 – atual)
- Responsável pelas campanhas de e-mail e automação no RD Station para base de 120 mil contatos.
- Aumentei a taxa de abertura de 18% para 26% com testes A/B de assunto.
- Gerencio verba de mídia paga (Google Ads e Meta Ads) de R$ 40 mil/mês.
- Produzo relatórios semanais no Google Analytics 4 e Looker Studio para a diretoria.

Assistente de Marketing — Padaria Trigo Bom (jan/2020 – fev/2022)
- Cuidei das redes sociais (Instagram e Facebook) e do calendário editorial.
- Organizei 3 eventos de lançamento de produto nas lojas.
- Apoiei a criação de materiais de ponto de venda com fornecedores gráficos.

Formação
Bacharelado em Publicidade e Propaganda — Universidade Presbiteriana Mackenzie (2016 – 2019)

Cursos
Google Analytics 4 — Google Skillshop (2023)
Automação de Marketing — RD University (2022)

Habilidades: RD Station, Google Ads, Meta Ads, GA4, Looker Studio, Excel intermediário, Canva, testes A/B.
Idiomas: Inglês intermediário, Espanhol básico.`;

// Segundo segmento, não-tech: o produto não é só marketing em SP (CLAUDE.md).
const CV_ENFERMAGEM = `Carlos Henrique Prado
carlos.prado@exemplo.com · (31) 97777-6666 · Belo Horizonte, MG
COREN-MG 000000

Enfermeiro Assistencial — Hospital Santa Clara (ago/2021 – atual)
Atuo na clínica médica com 28 leitos, em escala 12x36.
Faço sistematização da assistência de enfermagem (SAE) e supervisão de 6 técnicos por plantão.
Administração de medicamentos, curativos de média complexidade e passagem de plantão.
Participei da implantação do protocolo de prevenção de quedas em 2023.

Técnico de Enfermagem — UPA Norte (mar/2017 – jul/2021)
Atendimento de urgência e emergência, triagem com classificação de risco de Manchester.
Coleta de exames e acompanhamento de pacientes em observação.

Formação
Bacharelado em Enfermagem — Centro Universitário de Belo Horizonte (2016 – 2020)
Técnico em Enfermagem — Escola Técnica Vida (2014 – 2016)

Cursos: Suporte Básico de Vida (BLS) — 2024; Sala de Vacina — 2022.
Habilidades: SAE, classificação de risco, prontuário eletrônico MV, trabalho em equipe.`;

const CVS: Record<string, string> = { marketing: CV_FICTICIO, enfermeiro: CV_ENFERMAGEM };

const saida = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'curriculo-teste.pdf';
const cargo = process.argv.find((a) => a.startsWith('--cargo='))?.slice(8) ?? 'Analista de Marketing';
const vezes = Number(process.argv.find((a) => a.startsWith('--vezes='))?.slice(8) ?? 1);
const CV = /enferm/i.test(cargo) ? CVS['enfermeiro']! : CVS['marketing']!;

const url = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
const chave = process.env['SUPABASE_SERVICE_KEY']!;
const r = await fetch(
  `${url}/rest/v1/jobs?select=id,cargo,empresa,descricao,fonte&ativo=eq.true&fonte=eq.ats_gupy&cargo=ilike.*${encodeURIComponent(cargo)}*&order=data_referencia.desc&limit=10`,
  { headers: { apikey: chave, authorization: `Bearer ${chave}` } },
);
const vagas = (await r.json()) as Array<{ id: number; cargo: string; empresa: string; descricao: string | null; fonte: string }>;
const vaga = vagas.find(vagaAdaptavel);
if (!vaga) throw new Error(`nenhuma vaga adaptável de "${cargo}"`);
console.log(`vaga ${vaga.id}: ${vaga.cargo} — ${vaga.empresa} (${vaga.descricao!.length} caracteres)`);

// Guarda o consumo de cada chamada: o tier gratuito do Groq tem 8.000 tokens
// por minuto para o produto INTEIRO, e é esse número que diz quantas pessoas
// conseguem adaptar ao mesmo tempo.
let tokens: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } = {};
const fetchContando: typeof fetch = async (url, init) => {
  const r = await fetch(url, init);
  tokens = ((await r.clone().json().catch(() => ({}))) as { usage?: typeof tokens }).usage ?? {};
  return r;
};
const provedor: Provedor = process.env['GROQ_KEY']
  ? new ProvedorGroq({ chave: process.env['GROQ_KEY']!, modelo: process.env['GROQ_MODELO_CURRICULO'] || 'openai/gpt-oss-120b', fetchImpl: fetchContando })
  : new ProvedorGemini({ chave: process.env['GEMINI_KEY']!, modelo: process.env['GEMINI_MODELO'] || 'gemini-3.5-flash-lite' });

let cv!: ReturnType<typeof interpretarResposta>;
const titulos = new Set<string>();
for (let i = 1; i <= vezes; i++) {
  if (i > 1) await new Promise((r) => setTimeout(r, 40_000));
  const inicio = Date.now();
  let bruto: string;
  try {
    bruto = await provedor.julgar(montarPrompt(CV, vaga), undefined);
    cv = interpretarResposta(bruto);
  } catch (erro) {
    console.log(`rodada ${i}: FALHOU — ${String(erro).slice(0, 200)}`);
    continue;
  }
  const alertas = verificarFidelidade(CV, cv);
  titulos.add(cv.titulo);
  console.log(`\n--- rodada ${i}: ${provedor.nome}, ${Date.now() - inicio} ms, ${cv.experiencias.length} experiências, ${cv.lacunas.length} lacunas, ${alertas.length} alertas, tokens ${tokens.prompt_tokens ?? '?'} + ${tokens.completion_tokens ?? '?'} (raciocínio ${tokens.completion_tokens_details?.reasoning_tokens ?? '?'})`);
  console.log('titulo:', cv.titulo);
  console.log('lacunas:\n- ' + cv.lacunas.join('\n- '));
  if (alertas.length > 0) console.log('ALERTAS:', alertas.map((a) => `${a.tipo}: ${a.palavras?.join(', ') ?? a.trecho}`));
  {
    console.log('mudancas:\n- ' + cv.mudancas.join('\n- '));
    console.log('itens:\n' + cv.experiencias.map((e) => `${e.empresa}: ${e.itens.join(' | ')}`).join('\n'));
  }
}
console.log(`\ntítulos distintos em ${vezes} rodadas: ${titulos.size}`);
if (!cv) throw new Error('nenhuma rodada deu certo');

const pdf = await gerarPdf(cv);
await writeFile(saida, pdf);
console.log(`\nPDF: ${saida} (${pdf.length} bytes)`);

// Ida e volta: o PDF gerado precisa ser legível por quem extrai texto — é o que o ATS faz.
const { extractText, getDocumentProxy } = await import('unpdf');
const { text, totalPages } = await extractText(await getDocumentProxy(pdf), { mergePages: true });
console.log(`releitura: ${totalPages} página(s), ${text.length} caracteres; nome legível: ${text.includes(cv.nome)}`);
