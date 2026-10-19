/**
 * A pergunta que decide a trava 2: as vagas informais do Telegram estão na Gupy?
 *
 * `testar-telegram.ts` separou as mensagens por link — sem link externo e com
 * cargo no texto é o balde que interessa, porque ali o anúncio SÓ existe na
 * mensagem. Mas "só existe na mensagem" é afirmação sobre o Telegram, não sobre
 * o resto do mundo: a mesma vaga pode estar publicada num ATS sem o canal citar.
 *
 * Este script fecha a conta pelo outro lado. Para cada mensagem informal, extrai
 * o cargo do texto, pergunta à API pública da Gupy por esse cargo na cidade do
 * canal, e vê se volta alguma coisa da mesma família. Se voltar muito, o
 * Telegram é eco com contato de WhatsApp por cima; se voltar pouco, é acervo que
 * o produto não tem por nenhum outro caminho.
 *
 * LIMITE DA PROVA, e ele é assimétrico: a Gupy não é o universo das vagas
 * formais. "Não está na Gupy" não prova "não está em lugar nenhum" — prova que
 * não está na única fonte de ATS que o produto tem hoje, que é a pergunta
 * operacional certa para decidir se vale construir a camada.
 */
import { readFileSync } from 'node:fs';

import { buscarNaGupy } from '../src/fontes/gupy.ts';

/** Cidade de atuação de cada canal, para a consulta na Gupy ter o mesmo recorte. */
const CIDADE_DO_CANAL: Record<string, string> = {
  empregosmanausamoficial: 'Manaus',
  empregosbh: 'Belo Horizonte',
  rjempregos: 'Rio de Janeiro',
  vagasfortaleza: 'Fortaleza',
  empregosnomaranhao: 'São Luís',
};

const CARGO =
  /\b(analista|assistente|auxiliar|atendente|vendedor(?:a)?|operador(?:a)?|t[ée]cnic[oa]|enfermeir[oa]|desenvolvedor|programador|engenheir[oa]|designer|gerente|coordenador|supervisor|recepcionista|secret[áa]ri[oa]|motorista|cozinheir[oa]|gar[çc]om|gar[çc]onete|estagi[áa]ri[oa]|aprendiz|consultor|corretor|frentista|promotor|repositor|estoquista|padeiro|a[çc]ougueiro|camareir[oa]|porteiro|vigilante|zelador|faxineir[oa]|copeir[oa]|balconista|encarregado|pedreiro|eletricista|mec[âa]nico|soldador|costureir[oa]|manicure|cabeleireir[oa]|esteticista|barbeiro|professor|instrutor|redator|contador|advogado|farmac[êe]utic[oa]|nutricionista|fisioterapeuta|psic[óo]log[oa]|dentista|veterin[áa]ri[oa]|seguran[çc]a|entregador|fiscal|comprador|almoxarife|montador|inspetor|conferente|telemarketing|pesquisador)\b/i;

interface Rotulada {
  canal: string;
  url: string;
  texto: string;
  rotulo: string;
}

/** O bruto que `testar-telegram.ts` grava. `--de=<arquivo>` para reprocessar outro dia. */
const arquivo =
  process.argv.find((a) => a.startsWith('--de='))?.slice(5) ??
  `telegram-${new Date().toISOString().slice(0, 10)}.json`;

const bruto = JSON.parse(readFileSync(arquivo, 'utf8')) as { mensagens: Rotulada[] };
const informais = bruto.mensagens.filter(
  (m) => m.rotulo === 'informal_com_cargo' && CIDADE_DO_CANAL[m.canal],
);

console.log(`lendo ${arquivo}`);

console.log(`${informais.length} mensagens informais com cidade conhecida.\n`);

let comEco = 0;
let semEco = 0;
let semCargo = 0;
// Consulta que falhou não pode sumir do relatório: sem este contador, o
// denominador encolhe em silêncio e a porcentagem sai de uma amostra menor do
// que a anunciada. É a lição do achado 24 aplicada à própria medição.
let falhou = 0;
const linhas: string[] = [];

for (const m of informais) {
  const cargo = CARGO.exec(m.texto)?.[1];
  const cidade = CIDADE_DO_CANAL[m.canal];
  if (!cargo || !cidade) {
    semCargo++;
    continue;
  }

  const r = await buscarNaGupy({ cargo, cidade, limite: 100, janelaDias: 7 });
  if (r.falhou) {
    falhou++;
    console.error(`fonte falhou em "${cargo}" / ${cidade} — não conta como ausência`);
    continue;
  }

  if (r.vagas.length > 0) comEco++;
  else semEco++;

  linhas.push(
    `${(r.vagas.length > 0 ? 'GUPY TEM ' : 'gupy NAO ').padEnd(10)}${cargo.padEnd(16)}${cidade.padEnd(16)}${String(r.vagas.length).padStart(3)} vagas  | ${m.texto.slice(0, 70).replace(/\n/g, ' ')}`,
  );
}

for (const l of linhas) console.log(l);

const avaliadas = comEco + semEco;
console.log(
  `\n=== ${avaliadas} avaliadas de ${informais.length} informais ` +
    `(${semCargo} sem cargo extraível, ${falhou} com a Gupy fora do ar) ===`,
);
console.log(`a Gupy tem esse cargo na cidade:    ${comEco}  (${((comEco / avaliadas) * 100).toFixed(0)}%)`);
console.log(`a Gupy não tem nada desse cargo:    ${semEco}  (${((semEco / avaliadas) * 100).toFixed(0)}%)`);
console.log(
  '\nAtenção ao ler: "a Gupy tem esse cargo" NÃO é a mesma vaga — é a mesma\n' +
    'família de cargo na mesma cidade. É o limite superior do eco, não o eco.\n' +
    'O número que decide é o de baixo: onde a Gupy não devolve nada, o feed\n' +
    'ficaria vazio sem o Telegram.',
);
