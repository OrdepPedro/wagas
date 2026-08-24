/**
 * Os dorks generalizam para além de Product Manager?
 *
 * Tudo que foi medido até aqui é PM. O CLAUDE.md avisa que validar só com o
 * perfil do Pedro é amostra enviesada — este script é a checagem.
 *
 * Hipótese sob teste: o bloco de POSTS é um fenômeno de tech/white-collar.
 * Recrutador de vaga de tecnologia publica no LinkedIn; quem contrata auxiliar
 * administrativo ou enfermeiro provavelmente não. Se for verdade, o diferencial
 * do produto só vale para uma fatia do mercado — e isso é decisão de produto,
 * não ajuste de dork.
 *
 * Premissa nova do produto, refletida aqui:
 *   - janela fixa de 7 dias em TODOS os blocos (tbs=qdr:w);
 *   - o usuário informa cargo + cidade;
 *   - o feed junta: presencial/híbrido na cidade + remoto no Brasil inteiro.
 *     São duas consultas por bloco, não uma.
 *
 * Custo: cargos x 3 blocos x 2 recortes x 1 página.
 */
import { writeFileSync } from 'node:fs';

import { dedupPorHash } from '../src/dedupe.ts';
import { log } from '../src/logger.ts';
import { SerperCliente, SerperCreditosError } from '../src/serper/cliente.ts';
import { normalizarPaginaSerper } from '../src/serper/normalizar.ts';
import { ArquivoQuotaStore } from '../src/quota/store.ts';
import type { ResultadoNormalizado } from '../src/normalize/resultado.ts';
import type { Combinacao, Fonte } from '../src/tipos.ts';

const JANELA = 'qdr:w'; // últimos 7 dias
const CIDADE = 'São Paulo'; // maior mercado: separa "dork ruim" de "cidade sem vaga"
const CREDITOS_GRATUITOS = 2500;

/** Variados de propósito: dois de tech, um de dados, um white-collar, dois fora do escritório. */
const CARGOS = [
  'Product Manager',
  'Desenvolvedor Front-end',
  'Analista de Dados',
  'Analista de Marketing',
  'Auxiliar Administrativo',
  'Enfermeiro',
];

const TERMO_REMOTO = '("remoto" OR "home office" OR "100% remoto")';
const RUIDO_POSTS = '-curso -mentoria -programa';

type Recorte = 'cidade' | 'remoto';

interface Consulta {
  cargo: string;
  bloco: Exclude<Fonte, 'desconhecida'>;
  recorte: Recorte;
  dork: string;
}

function consultas(cargo: string): Consulta[] {
  const local = `"${CIDADE}"`;
  return [
    {
      cargo,
      bloco: 'linkedin_job',
      recorte: 'cidade',
      dork: `site:linkedin.com/jobs/view "${cargo}" ${local}`,
    },
    {
      cargo,
      bloco: 'linkedin_job',
      recorte: 'remoto',
      dork: `site:linkedin.com/jobs/view "${cargo}" ${TERMO_REMOTO}`,
    },
    {
      cargo,
      bloco: 'linkedin_post',
      recorte: 'cidade',
      dork: `site:linkedin.com/posts "${cargo.toLowerCase()}" ${local} ("contratando" OR "vaga" OR "hiring") ${RUIDO_POSTS}`,
    },
    {
      cargo,
      bloco: 'linkedin_post',
      recorte: 'remoto',
      dork: `site:linkedin.com/posts "${cargo.toLowerCase()}" ("contratando" OR "vaga" OR "hiring") ${TERMO_REMOTO} ${RUIDO_POSTS}`,
    },
    {
      cargo,
      bloco: 'ats_gupy',
      recorte: 'cidade',
      dork: `site:gupy.io "${cargo}" ${local}`,
    },
    {
      cargo,
      bloco: 'ats_gupy',
      recorte: 'remoto',
      dork: `site:gupy.io "${cargo}" "remoto"`,
    },
  ];
}

function comboFalso(c: Consulta): Combinacao {
  return {
    id: `${c.cargo}|${c.bloco}|${c.recorte}`,
    cargo: c.cargo,
    modelo: c.recorte === 'remoto' ? 'remoto' : 'qualquer',
    localizacao: c.recorte === 'cidade' ? CIDADE : null,
    fonte: c.bloco,
    dork: c.dork,
    dateRestrict: 'd7',
    paginas: 1,
    ativo: true,
  };
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');
  const argPaginas = process.argv.find((a) => a.startsWith('--paginas='));
  const paginas = argPaginas ? Number(argPaginas.slice('--paginas='.length)) : 1;
  if (!Number.isFinite(paginas) || paginas < 1 || paginas > 10) {
    throw new Error('--paginas fora de 1..10');
  }

  const todas = CARGOS.flatMap(consultas);
  const custo = todas.length * paginas;

  console.log(`\nGeneralização dos dorks — ${CARGOS.length} cargos x 3 blocos x 2 recortes`);
  console.log(`  janela: últimos 7 dias | cidade: ${CIDADE} | páginas: ${paginas}`);
  console.log(`  custo: ${custo} créditos\n`);

  if (dryRun) {
    for (const c of todas) console.log(`  [${c.bloco}/${c.recorte}] ${c.dork}`);
    return 0;
  }

  const key = process.env['SERPER_KEY']?.trim();
  if (!key) {
    log.error('SERPER_KEY ausente');
    return 1;
  }

  const store = new ArquivoQuotaStore('.quota/serper.json');
  const concedidos = await store.reservar('serper', custo, CREDITOS_GRATUITOS);
  if (concedidos < custo) {
    log.error('créditos insuficientes', { pedidos: custo, concedidos });
    await store.devolver('serper', concedidos);
    return 1;
  }

  const cliente = new SerperCliente({ key, orcamento: concedidos });

  // cargo -> bloco -> resultados (dedup só no fim, ver abaixo)
  const coletado = new Map<string, Map<string, ResultadoNormalizado[]>>();
  const amostras: Array<{ cargo: string; bloco: string; recorte: string; titulo: string }> = [];

  try {
    for (const c of todas) {
      for (let pagina = 1; pagina <= paginas; pagina++) {
        if (cliente.restante <= 0) break;
        try {
          const { organicos } = await cliente.buscar(c.dork, { pagina, tbs: JANELA });
          // Página vazia = acabou o acervo deste dork. Parar aqui economiza
          // crédito e é o sinal de que o número NÃO está truncado pelo teto.
          if (organicos.length === 0) break;

          const { normalizados } = normalizarPaginaSerper(organicos, {
            combo: comboFalso(c),
            pagina,
          });
          // A dedup NÃO pode ser por consulta: "cidade" e "remoto" trazem a mesma
          // vaga quando ela é remota e a empresa fica na cidade. Deduplicar aqui
          // dentro contaria essa vaga duas vezes no total do cargo.
          if (!coletado.has(c.cargo)) coletado.set(c.cargo, new Map());
          const linha = coletado.get(c.cargo)!;
          linha.set(c.bloco, [...(linha.get(c.bloco) ?? []), ...normalizados]);

          if (pagina === 1) {
            for (const u of dedupPorHash(normalizados).unicos.slice(0, 3)) {
              amostras.push({ cargo: c.cargo, bloco: c.bloco, recorte: c.recorte, titulo: u.titulo });
            }
          }

          log.info('consulta', {
            cargo: c.cargo,
            bloco: c.bloco,
            recorte: c.recorte,
            pagina,
            resultados: normalizados.length,
          });
        } catch (erro) {
          if (erro instanceof SerperCreditosError) throw erro;
          log.error('consulta falhou', { cargo: c.cargo, bloco: c.bloco, pagina, erro: String(erro) });
          break;
        }
      }
    }
  } finally {
    const sobra = concedidos - cliente.consumidos;
    if (sobra > 0) await store.devolver('serper', sobra);
  }

  const blocos: Array<Exclude<Fonte, 'desconhecida'>> = ['linkedin_job', 'linkedin_post', 'ats_gupy'];

  console.log(`\n${'═'.repeat(74)}`);
  console.log('VAGAS ÚNICAS NOS ÚLTIMOS 7 DIAS (cidade + remoto somados)');
  console.log(`${'═'.repeat(74)}`);
  console.log('  ' + 'cargo'.padEnd(26) + blocos.map((b) => b.padEnd(15)).join('') + 'total');
  for (const cargo of CARGOS) {
    const linha = coletado.get(cargo) ?? new Map<string, ResultadoNormalizado[]>();
    const doCargo: ResultadoNormalizado[] = [];
    const celulas = blocos.map((b) => {
      const brutos = linha.get(b) ?? [];
      doCargo.push(...brutos);
      const { unicos, duplicados } = dedupPorHash(brutos);
      // "12(3)" = 12 únicas, 3 delas apareceram nos dois recortes.
      return `${unicos.length}${duplicados.length > 0 ? `(${duplicados.length})` : ''}`.padEnd(15);
    });
    const total = dedupPorHash(doCargo).unicos.length;
    console.log('  ' + cargo.padEnd(26) + celulas.join('') + total);
  }
  console.log('\n  formato: únicas(repetidas entre os recortes cidade/remoto)');
  console.log(`  teto do teste: ${paginas * 2 * 10} por bloco. Bateu no teto = truncado.`);

  console.log(`\nAmostra de títulos por bloco (checar se é vaga de verdade do cargo):`);
  for (const bloco of blocos) {
    console.log(`\n  --- ${bloco} ---`);
    for (const a of amostras.filter((x) => x.bloco === bloco).slice(0, 12)) {
      console.log(`    [${a.cargo}] ${a.titulo.slice(0, 62)}`);
    }
  }

  const saldo = await store.estado('serper', CREDITOS_GRATUITOS);
  console.log(
    `\ncréditos: ${cliente.consumidos} nesta execução; ${saldo.consumidas}/${CREDITOS_GRATUITOS} no total.`,
  );

  // A matriz vai para o arquivo, não só para o stdout: resultado de medição que
  // só existe no terminal se perde no primeiro `tail` mal dimensionado.
  const resumo = CARGOS.map((cargo) => {
    const linha = coletado.get(cargo) ?? new Map<string, ResultadoNormalizado[]>();
    const doCargo: ResultadoNormalizado[] = [];
    const porBloco: Record<string, { unicas: number; repetidas: number; saturou: boolean }> = {};
    for (const b of blocos) {
      const brutos = linha.get(b) ?? [];
      doCargo.push(...brutos);
      const { unicos, duplicados } = dedupPorHash(brutos);
      porBloco[b] = {
        unicas: unicos.length,
        repetidas: duplicados.length,
        saturou: brutos.length >= paginas * 2 * 10,
      };
    }
    return { cargo, porBloco, total: dedupPorHash(doCargo).unicos.length };
  });

  const arquivo = `cargos-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(
    arquivo,
    JSON.stringify(
      { cidade: CIDADE, janela: JANELA, paginas, tetoPorBloco: paginas * 2 * 10, resumo, amostras },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`bruto salvo em ${arquivo}`);

  return 0;
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((erro: unknown) => {
    log.error('teste abortado', { erro: erro instanceof Error ? erro.message : String(erro) });
    process.exitCode = 1;
  });
