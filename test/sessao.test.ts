import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * A lógica de repetição de sessão, testada sem o Next.
 *
 * `ehRepeticao` é função pura de propósito: a parte que fala com o framework
 * (ler e gravar cookie) é fina e não decide nada. Foi isso que permitiu mover a
 * ESCRITA para a Server Action sem reescrever a regra — o Next só deixa gravar
 * cookie em Server Action ou Route Handler, e a primeira versão gravava durante
 * a renderização, num try/catch que engolia o erro e fingia funcionar.
 */
interface BuscaDaSessao {
  chave: string;
  repetida: boolean;
  em: number;
}

const VALIDADE_MS = 30 * 60_000;

function ehRepeticao(salvo: BuscaDaSessao | null, chave: string, agora: number): boolean {
  if (!salvo) return false;
  return salvo.chave === chave && salvo.repetida && agora - salvo.em < VALIDADE_MS;
}

const AGORA = 1_800_000_000_000;
const CHAVE = 'enfermeiro|belo horizonte|c';

test('sessão vazia nunca é repetição', () => {
  assert.equal(ehRepeticao(null, CHAVE, AGORA), false);
});

/**
 * A condição que não é óbvia: a PRIMEIRA busca de um cargo grava a sessão com
 * `repetida: false`. Sem isso, ela seria tratada como repetida no carregamento
 * seguinte e o cargo nunca seria coletado.
 */
test('primeira busca de um cargo não conta como repetição', () => {
  const salvo = { chave: CHAVE, repetida: false, em: AGORA };
  assert.equal(ehRepeticao(salvo, CHAVE, AGORA), false);
});

test('segunda submissão da mesma busca conta', () => {
  const salvo = { chave: CHAVE, repetida: true, em: AGORA };
  assert.equal(ehRepeticao(salvo, CHAVE, AGORA), true);
});

test('busca diferente não aproveita a sessão', () => {
  const salvo = { chave: CHAVE, repetida: true, em: AGORA };
  assert.equal(ehRepeticao(salvo, 'enfermeiro|salvador|c', AGORA), false);
});

/** O cookie não pode ser mais otimista que o frescor do banco. */
test('a sessão vence junto com o frescor da coleta', () => {
  const salvo = { chave: CHAVE, repetida: true, em: AGORA - 31 * 60_000 };
  assert.equal(ehRepeticao(salvo, CHAVE, AGORA), false);
});

/** O toggle "Só Remoto" muda o resultado, então muda a chave. */
test('trocar o só-remoto invalida a sessão', () => {
  const salvo = { chave: 'enfermeiro|belo horizonte|c', repetida: true, em: AGORA };
  assert.equal(ehRepeticao(salvo, 'enfermeiro|belo horizonte|r', AGORA), false);
});
