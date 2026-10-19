/**
 * Telegram como fonte de vaga em texto informal — a medição que decide a trava 2.
 *
 * A PERGUNTA, DECOMPOSTA EM COISA MEDÍVEL. "É vaga que a Gupy não tem" não é
 * observável direto numa mensagem. O que é observável é o LINK que ela carrega,
 * e ele separa mundos: link externo significa que a vaga tem página em algum
 * lugar e é descobrível por outro caminho; só contato (WhatsApp, e-mail) ou link
 * nenhum significa que o anúncio É a mensagem. Essa segunda fatia é o número que
 * decide. Se for perto de zero, o Telegram é eco e a hipótese morre barato, que
 * era o objetivo de medir antes de codar.
 *
 * A classificação mora em `src/fontes/telegram.ts` e tem teste. Aqui fica só a
 * varredura e o relatório.
 *
 * O QUE ESTE SCRIPT NÃO PROVA, e precisa ficar escrito antes de alguém citar o
 * número: os canais foram achados por busca na web, então a amostra favorece
 * quem faz SEO — e quem faz SEO é justamente o agregador. Canal pequeno de
 * recrutador, que é onde o texto informal deve morar, é sub-representado. O
 * viés empurra o resultado PARA BAIXO: um número alto de informal nesta amostra
 * é forte; um número baixo seria inconclusivo, não prova de ausência.
 *
 * Zero crédito, zero chave, zero conta. Só GET anônimo em página pública.
 */
import { writeFileSync } from 'node:fs';

import { classificar, lerCanal, type Balde, type MensagemDeCanal } from '../src/fontes/telegram.ts';

const JANELA_DIAS = 7;

/**
 * Painel de canais. Dois critérios explícitos: estar VIVO (última mensagem
 * dentro de ~30 dias, verificado antes) e cobrir segmento variado — o CLAUDE.md
 * proíbe validar só com o perfil do Pedro. Seis gerais/regionais contra quatro
 * de tech, porque o acervo atual já é enviesado para tech e é em não-tech que a
 * Gupy é forte (achado 9) — ou seja, é ali que o eco dói mais.
 */
const CANAIS = [
  { nome: 'rjempregos', segmento: 'geral/RJ' },
  { nome: 'empregosmanausamoficial', segmento: 'geral/AM' },
  { nome: 'empregosbh', segmento: 'geral/MG' },
  { nome: 'vagasfortaleza', segmento: 'geral/CE' },
  { nome: 'empregosnomaranhao', segmento: 'geral/MA' },
  { nome: 'rectrab', segmento: 'geral/BR' },
  { nome: 'vagasfront', segmento: 'tech/front' },
  { nome: 'vagasbackend', segmento: 'tech/back' },
  { nome: 'CafeinaVagas', segmento: 'tech/inicio' },
  { nome: 'vagasdedadosjunior', segmento: 'tech/dados' },
];

const agora = Date.now();
const corte = agora - JANELA_DIAS * 24 * 60 * 60 * 1000;

console.log(`Lendo ${CANAIS.length} canais, janela de ${JANELA_DIAS} dias.\n`);

const todas: MensagemDeCanal[] = [];
for (const c of CANAIS) {
  const { mensagens, falhou } = await lerCanal(c.nome, c.segmento, corte);
  const naJanela = mensagens.filter((m) => Date.parse(m.dataIso) >= corte);
  const aviso = falhou ? '  <- FONTE FALHOU, não é "canal vazio"' : '';
  console.log(
    `${c.nome.padEnd(26)} ${String(mensagens.length).padStart(4)} lidas  ${String(naJanela.length).padStart(4)} na janela${aviso}`,
  );
  todas.push(...naJanela);
}

const porBalde = new Map<Balde, MensagemDeCanal[]>();
for (const m of todas) {
  const b = classificar(m);
  if (!porBalde.has(b)) porBalde.set(b, []);
  porBalde.get(b)!.push(m);
}

console.log(`\n=== ${todas.length} mensagens na janela de ${JANELA_DIAS} dias ===\n`);
const ordem: Balde[] = [
  'informal_com_cargo',
  'informal_sem_cargo',
  'bot_agregador',
  'portal',
  'so_imagem',
  'spam_curso',
];
for (const b of ordem) {
  const n = porBalde.get(b)?.length ?? 0;
  const pct = todas.length ? ((n / todas.length) * 100).toFixed(1) : '0';
  console.log(`${b.padEnd(20)} ${String(n).padStart(4)}  ${pct.padStart(5)}%`);
}

console.log('\n=== por canal ===');
console.log('canal'.padEnd(26) + 'total  bot  portal  imagem  spam  inf+cargo  inf-cargo');
for (const c of CANAIS) {
  const suas = todas.filter((m) => m.canal === c.nome);
  if (!suas.length) {
    console.log(c.nome.padEnd(26) + '    0  (nada na janela)');
    continue;
  }
  const cont = (b: Balde) => suas.filter((m) => classificar(m) === b).length;
  console.log(
    c.nome.padEnd(26) +
      String(suas.length).padStart(5) +
      String(cont('bot_agregador')).padStart(5) +
      String(cont('portal')).padStart(8) +
      String(cont('so_imagem')).padStart(8) +
      String(cont('spam_curso')).padStart(6) +
      String(cont('informal_com_cargo')).padStart(11) +
      String(cont('informal_sem_cargo')).padStart(11),
  );
}

console.log('\n=== frescor (idade da mensagem no momento da leitura) ===');
const idades = todas.map((m) => (agora - Date.parse(m.dataIso)) / 3_600_000).sort((a, b) => a - b);
const faixa = (lo: number, hi: number) => idades.filter((h) => h >= lo && h < hi).length;
console.log(`menos de 1h  ${faixa(0, 1)}`);
console.log(`1h a 6h      ${faixa(1, 6)}`);
console.log(`6h a 24h     ${faixa(6, 24)}`);
console.log(`1 a 3 dias   ${faixa(24, 72)}`);
console.log(`3 a 7 dias   ${faixa(72, 168)}`);

/** Assinatura para dedup entre canais: sem link, sem pontuação, primeiros 120 chars. */
function assinatura(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9áàâãéêíóôõúç ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

console.log('\n=== republicação entre canais ===');
const porAssinatura = new Map<string, Set<string>>();
for (const m of todas) {
  const a = assinatura(m.texto);
  if (a.length < 30) continue;
  if (!porAssinatura.has(a)) porAssinatura.set(a, new Set());
  porAssinatura.get(a)!.add(m.canal);
}
console.log(`assinaturas distintas: ${porAssinatura.size}`);
console.log(`em mais de um canal:   ${[...porAssinatura.values()].filter((s) => s.size > 1).length}`);

const arquivo = `telegram-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(
  arquivo,
  JSON.stringify(
    {
      lidoEm: new Date().toISOString(),
      canais: CANAIS,
      mensagens: todas.map((m) => ({ ...m, rotulo: classificar(m) })),
    },
    null,
    2,
  ),
);
console.log(`\nbruto em ${arquivo}`);
