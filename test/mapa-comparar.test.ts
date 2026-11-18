import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComparacaoInvalida,
  interpretarComparacao,
  interpretarExtracao,
  placar,
  type RequisitoDaVaga,
} from '../src/mapa/comparar.ts';

const CV = `Analista de Dados — Empresa X (2021–2024)
• Construí painéis no Power BI para a diretoria comercial.
• Automatizei relatórios em Python com pandas, reduzindo 6 horas por semana.
Competências: SQL, Excel avançado, Looker Studio
Formação: Bacharelado em Estatística`;

const json = (requisitos: unknown[]) => JSON.stringify({ requisitos });
const vaga = (...termos: string[]): RequisitoDaVaga[] => termos.map((termo) => ({ termo, essencial: true }));

test('extração: tira duplicados e vazios, e recusa vaga com menos de 3 requisitos', () => {
  const r = interpretarExtracao(
    json([
      { termo: 'SQL', essencial: true },
      { termo: 'sql', essencial: false },
      { termo: '  ', essencial: true },
      { termo: 'Python', essencial: false },
      { termo: 'Power BI', essencial: true },
    ]),
  );
  assert.deepEqual(r.map((x) => x.termo), ['SQL', 'Python', 'Power BI']);
  assert.equal(r[1]!.essencial, false);
  assert.throws(() => interpretarExtracao(json([{ termo: 'SQL', essencial: true }])), ComparacaoInvalida);
});

test('a saída é a lista da VAGA: termo e "essencial" nunca vêm do modelo', () => {
  const daVaga: RequisitoDaVaga[] = [{ termo: 'Python', essencial: false }];
  const { requisitos } = interpretarComparacao(
    json([{ termo: 'python', essencial: true, status: 'demonstrado', trecho: 'automatizei relatorios em python com pandas' }]),
    CV,
    daVaga,
  );
  assert.equal(requisitos[0]!.termo, 'Python');
  assert.equal(requisitos[0]!.essencial, false);
  assert.equal(requisitos[0]!.status, 'demonstrado');
});

test('requisito que o modelo pulou é erro, não "falta"', () => {
  assert.throws(
    () => interpretarComparacao(json([{ termo: 'SQL', status: 'sem_contexto', trecho: 'SQL, Excel avançado' }]), CV, vaga('SQL', 'Tableau')),
    ComparacaoInvalida,
  );
});

test('credencial conferida no CV é "demonstrado", não importa o que o modelo disse', () => {
  const daVaga: RequisitoDaVaga[] = [
    { termo: 'Bacharelado em Estatística', essencial: true, credencial: true },
    { termo: 'SQL', essencial: true },
  ];
  const { requisitos } = interpretarComparacao(
    json([
      { termo: 'Bacharelado em Estatística', status: 'sem_contexto', trecho: 'Formação: Bacharelado em Estatística' },
      { termo: 'SQL', status: 'sem_contexto', trecho: 'Competências: SQL, Excel avançado' },
    ]),
    CV,
    daVaga,
  );
  assert.equal(requisitos[0]!.status, 'demonstrado');
  // Ferramenta só numa lista continua sem contexto.
  assert.equal(requisitos[1]!.status, 'sem_contexto');
});

test('credencial com citação inventada não vira "demonstrado"', () => {
  const { requisitos } = interpretarComparacao(
    json([{ termo: 'COREN ativo', status: 'sem_contexto', trecho: 'COREN-SP ativo desde 2019' }]),
    CV,
    [{ termo: 'COREN ativo', essencial: true, credencial: true }],
  );
  assert.equal(requisitos[0]!.status, 'ausente');
});

test('termo reescrito pelo modelo é casado pela posição', () => {
  const { requisitos } = interpretarComparacao(
    json([{ termo: 'Conhecimento em SQL', status: 'sem_contexto', trecho: 'Competências: SQL, Excel avançado' }]),
    CV,
    vaga('SQL'),
  );
  assert.equal(requisitos[0]!.status, 'sem_contexto');
});

test('citação inventada com o termo no CV cai para sem_contexto', () => {
  const { requisitos, rebaixados } = interpretarComparacao(
    json([{ termo: 'SQL', status: 'demonstrado', trecho: 'Escrevi consultas SQL complexas no BigQuery' }]),
    CV,
    vaga('SQL'),
  );
  assert.equal(rebaixados, 1);
  assert.equal(requisitos[0]!.status, 'sem_contexto');
  assert.equal(requisitos[0]!.trecho, null);
});

test('citação inventada sem o termo no CV cai para ausente — o erro caro é dizer "você tem"', () => {
  const { requisitos } = interpretarComparacao(
    json([{ termo: 'Tableau', status: 'demonstrado', trecho: 'Criei dashboards em Tableau' }]),
    CV,
    vaga('Tableau'),
  );
  assert.equal(requisitos[0]!.status, 'ausente');
});

test('termo como palavra inteira: "R" não casa com qualquer letra do CV', () => {
  const { requisitos } = interpretarComparacao(json([{ termo: 'R', status: 'sem_contexto', trecho: 'R' }]), CV, vaga('R'));
  assert.equal(requisitos[0]!.status, 'ausente');
});

test('grafia diferente que existe no CV segura o sem_contexto', () => {
  const { requisitos } = interpretarComparacao(
    json([{ termo: 'Google Data Studio', status: 'sem_contexto', grafiaNoCurriculo: 'Looker Studio', trecho: 'x' }]),
    CV,
    vaga('Google Data Studio'),
  );
  assert.equal(requisitos[0]!.status, 'sem_contexto');
  assert.equal(requisitos[0]!.grafiaNoCurriculo, 'Looker Studio');
});

test('ausente nunca carrega trecho; status inválido é erro', () => {
  const { requisitos } = interpretarComparacao(
    json([{ termo: 'Inglês avançado', status: 'ausente', trecho: 'qualquer coisa' }]),
    CV,
    vaga('Inglês avançado'),
  );
  assert.equal(requisitos[0]!.trecho, null);
  assert.throws(() => interpretarComparacao(json([{ termo: 'Spark', status: 'talvez' }]), CV, vaga('Spark')), ComparacaoInvalida);
  assert.throws(() => interpretarComparacao('não é json', CV, vaga('Spark')), ComparacaoInvalida);
});

test('placar conta os essenciais; sem essencial, conta todos', () => {
  const base = { grafiaNoCurriculo: null };
  assert.deepEqual(
    placar([
      { ...base, termo: 'a', essencial: true, status: 'demonstrado' },
      { ...base, termo: 'b', essencial: true, status: 'sem_contexto' },
      { ...base, termo: 'c', essencial: true, status: 'ausente' },
      { ...base, termo: 'd', essencial: false, status: 'demonstrado' },
    ]),
    { total: 3, demonstrados: 1, semContexto: 1, essenciais: true },
  );
  assert.equal(placar([{ ...base, termo: 'd', essencial: false, status: 'demonstrado' }]).essenciais, false);
});
