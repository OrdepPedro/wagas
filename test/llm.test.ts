import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CadeiaDeProvedores,
  cadeiaDoAmbiente,
  LlmErro,
  LlmIndisponivel,
  LlmSobrecarregado,
  ProvedorGemini,
  ProvedorGroq,
} from '../src/classificar/llm.ts';

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchFalso(sequencia: Array<() => Response>): { fn: typeof fetch; chamadas: Request[] } {
  const chamadas: Request[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push(new Request(typeof url === 'string' ? url : String(url), init));
    const proximo = sequencia[Math.min(i, sequencia.length - 1)];
    i++;
    return proximo!();
  }) as unknown as typeof fetch;
  return { fn, chamadas };
}

const textoGemini = (t: string) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
const textoGroq = (t: string) => ({ choices: [{ message: { content: t } }] });

describe('ProvedorGemini', () => {
  it('manda o schema e devolve o texto', async () => {
    const { fn, chamadas } = fetchFalso([() => resposta(textoGemini('{"julgamentos":[]}'))]);
    const provedor = new ProvedorGemini({ chave: 'k', modelo: 'gemini-2.5-flash-lite', fetchImpl: fn });

    assert.equal(await provedor.julgar('prompt', { type: 'object' }), '{"julgamentos":[]}');
    assert.equal(provedor.nome, 'gemini/gemini-2.5-flash-lite');

    const enviado = JSON.parse(await chamadas[0]!.text());
    assert.equal(enviado.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(enviado.generationConfig.responseSchema, { type: 'object' });
    // Classificação não quer criatividade: mesma entrada, mesma saída.
    assert.equal(enviado.generationConfig.temperature, 0);
  });

  it('429 vira indisponível sem retry: no tier gratuito é cota do dia', async () => {
    const { fn, chamadas } = fetchFalso([() => resposta({ error: { message: 'quota' } }, 429)]);
    const provedor = new ProvedorGemini({ chave: 'k', modelo: 'm', fetchImpl: fn });

    await assert.rejects(() => provedor.julgar('p', null), LlmIndisponivel);
    assert.equal(chamadas.length, 1);
  });

  it('repete em 503 e devolve o resultado bom', async () => {
    let n = 0;
    const { fn } = fetchFalso([
      () => (n++ === 0 ? resposta({}, 503) : resposta(textoGemini('{"julgamentos":[]}'))),
    ]);
    const provedor = new ProvedorGemini({
      chave: 'k',
      modelo: 'm',
      fetchImpl: fn,
      sleepImpl: async () => {},
    });

    assert.equal(await provedor.julgar('p', null), '{"julgamentos":[]}');
  });

  it('resposta sem texto não é retentada: é defeito do lote, não da rede', async () => {
    const { fn, chamadas } = fetchFalso([() => resposta({ candidates: [] })]);
    const provedor = new ProvedorGemini({
      chave: 'k',
      modelo: 'm',
      fetchImpl: fn,
      sleepImpl: async () => {},
    });

    await assert.rejects(() => provedor.julgar('p', null), LlmErro);
    assert.equal(chamadas.length, 1);
  });
});

describe('ProvedorGroq', () => {
  it('pede json_object e devolve o conteúdo da mensagem', async () => {
    const { fn, chamadas } = fetchFalso([() => resposta(textoGroq('{"julgamentos":[]}'))]);
    const provedor = new ProvedorGroq({ chave: 'k', modelo: 'llama-3.3-70b-versatile', fetchImpl: fn });

    assert.equal(await provedor.julgar('p', null), '{"julgamentos":[]}');

    const enviado = JSON.parse(await chamadas[0]!.text());
    assert.deepEqual(enviado.response_format, { type: 'json_object' });
    assert.equal(chamadas[0]!.headers.get('authorization'), 'Bearer k');
    // Sem opção, o corpo não muda: o classificador segue igual.
    assert.equal(enviado.max_completion_tokens, undefined);
    assert.equal(enviado.reasoning_effort, undefined);
  });

  it('manda teto de saída e esforço de raciocínio quando pedidos', async () => {
    const { fn, chamadas } = fetchFalso([() => resposta(textoGroq('{}'))]);
    const provedor = new ProvedorGroq({ chave: 'k', modelo: 'm', fetchImpl: fn, maxTokens: 4000, reasoningEffort: 'low' });
    await provedor.julgar('p', null);
    const enviado = JSON.parse(await chamadas[0]!.text());
    assert.equal(enviado.max_completion_tokens, 4000);
    assert.equal(enviado.reasoning_effort, 'low');
  });

  it('resposta cortada no teto de tokens é erro, mesmo sendo JSON válido', async () => {
    // Caso real de 03/11: o modo JSON fechou as chaves e o currículo veio sem formação.
    const cortada = { choices: [{ finish_reason: 'length', message: { content: '{"nome":"x","experiencias":[]}' } }] };
    const { fn, chamadas } = fetchFalso([() => resposta(cortada)]);
    const provedor = new ProvedorGroq({ chave: 'k', modelo: 'm', fetchImpl: fn, sleepImpl: async () => {} });
    await assert.rejects(() => provedor.julgar('p', null), /limite de tokens/);
    assert.equal(chamadas.length, 1);
  });
});

describe('cadeiaDoAmbiente', () => {
  const base = { geminiModelo: 'g', groqModelo: 'q' };

  it('sem chave nenhuma, devolve null', () => {
    assert.equal(cadeiaDoAmbiente({ ...base, geminiKey: '', groqKey: '' }), null);
  });

  it('o Gemini vem primeiro quando as duas chaves existem', () => {
    const cadeia = cadeiaDoAmbiente({ ...base, geminiKey: 'a', groqKey: 'b' });
    assert.equal(cadeia?.nome, 'gemini/g');
  });

  it('só o Groq configurado, a cadeia é só ele', () => {
    assert.equal(cadeiaDoAmbiente({ ...base, geminiKey: '', groqKey: 'b' })?.nome, 'groq/q');
  });
});

describe('sobrecarga do modelo (503)', () => {
  const semEspera = async () => {};

  it('503 em todas as tentativas vira LlmSobrecarregado', async () => {
    const { fn, chamadas } = fetchFalso([() => resposta({ error: { message: 'high demand' } }, 503)]);
    const provedor = new ProvedorGemini({ chave: 'k', modelo: 'm', tentativas: 2, fetchImpl: fn, sleepImpl: semEspera });

    await assert.rejects(() => provedor.julgar('p', null), LlmSobrecarregado);
    assert.equal(chamadas.length, 2);
  });

  it('500 em todas as tentativas continua LlmErro comum: só o 503 é sobrecarga', async () => {
    const { fn } = fetchFalso([() => resposta({}, 500)]);
    const provedor = new ProvedorGemini({ chave: 'k', modelo: 'm', tentativas: 2, fetchImpl: fn, sleepImpl: semEspera });

    await assert.rejects(
      () => provedor.julgar('p', null),
      (erro) => erro instanceof LlmErro && !(erro instanceof LlmSobrecarregado),
    );
  });

  it('a cadeia cai para o modelo de reserva e registra quem respondeu', async () => {
    const principal = fetchFalso([() => resposta({}, 503)]);
    const reserva = fetchFalso([() => resposta(textoGemini('{"ok":true}'))]);
    const cadeia = new CadeiaDeProvedores([
      new ProvedorGemini({ chave: 'k', modelo: 'principal', tentativas: 2, fetchImpl: principal.fn, sleepImpl: semEspera }),
      new ProvedorGemini({ chave: 'k', modelo: 'reserva', tentativas: 2, fetchImpl: reserva.fn, sleepImpl: semEspera }),
    ]);

    assert.equal(await cadeia.julgar('p', null), '{"ok":true}');
    assert.equal(cadeia.nome, 'gemini/reserva');
  });

  it('todos sobrecarregados não vira "limite de uso": a tela diz outra coisa', async () => {
    const { fn } = fetchFalso([() => resposta({}, 503)]);
    const cadeia = new CadeiaDeProvedores([
      new ProvedorGemini({ chave: 'k', modelo: 'a', tentativas: 1, fetchImpl: fn }),
      new ProvedorGemini({ chave: 'k', modelo: 'b', tentativas: 1, fetchImpl: fn }),
    ]);

    await assert.rejects(
      () => cadeia.julgar('p', null),
      (erro) => erro instanceof LlmSobrecarregado && !(erro instanceof LlmIndisponivel),
    );
  });

  it('resposta sem texto não desce: é defeito do lote, e gastaria a reserva', async () => {
    const principal = fetchFalso([() => resposta({ candidates: [] })]);
    const reserva = fetchFalso([() => resposta(textoGemini('{}'))]);
    const cadeia = new CadeiaDeProvedores([
      new ProvedorGemini({ chave: 'k', modelo: 'a', fetchImpl: principal.fn }),
      new ProvedorGemini({ chave: 'k', modelo: 'b', fetchImpl: reserva.fn }),
    ]);

    await assert.rejects(() => cadeia.julgar('p', null), LlmErro);
    assert.equal(reserva.chamadas.length, 0);
  });
});
