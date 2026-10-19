import test from 'node:test';
import assert from 'node:assert/strict';

import { classificar, ehLinkDeContato, extrairMensagens, lerCanal } from '../src/fontes/telegram.ts';

/**
 * A regressão que motivou o arquivo inteiro.
 *
 * A primeira versão da medição casava `whatsapp` como SUBSTRING da URL. As vagas
 * do canal `rjempregos` apontam para o portal próprio com slug terminado em
 * `-whatsapp`, então 240 republicações de portal foram contadas como anúncio "só
 * texto" e a fatia que decide o teste saiu 47% em vez de 10,6%.
 *
 * O erro caiu A FAVOR da hipótese sob julgamento, que é o pior lado possível: um
 * teste que só medisse o caminho feliz teria deixado passar, e a conclusão do
 * experimento seria o contrário da verdade.
 */
test('link de portal com "whatsapp" no slug não é link de contato', () => {
  assert.equal(
    ehLinkDeContato('https://rioempregos.com.br/vagasrj/operador-de-caixa-rede-supermarket-whatsapp/'),
    false,
  );
  assert.equal(ehLinkDeContato('https://wa.me/5531984773056'), true);
  assert.equal(ehLinkDeContato('https://api.whatsapp.com/send?phone=5592999999'), true);
  assert.equal(ehLinkDeContato('mailto:contato@restaurantesaborami.com.br'), true);
});

test('link quebrado não vira link de contato por acidente', () => {
  assert.equal(ehLinkDeContato('nao é uma url'), false);
  assert.equal(ehLinkDeContato(''), false);
});

test('mensagem sem texto é panfleto, não ausência de vaga', () => {
  // 31 das 32 mensagens do canal de Fortaleza são imagem pura: a vaga está
  // DENTRO do panfleto. Contá-las como "não é vaga" esconderia o custo real
  // (precisa de OCR) atrás de um número que parece limpo.
  assert.equal(classificar({ texto: '   ', links: [] }), 'so_imagem');
});

test('robô que republica vaga do LinkedIn não conta como anúncio informal', () => {
  // Sem link no HTML público, a regra de link sozinha chamaria isto de "só
  // texto" — que é o oposto do que é.
  const bot = {
    texto:
      '🚨Nova vaga encontrada🚨 📜Título: Desenvolvedor Front-end 🏢Empresa: hub xp 🌍Local: São Paulo ✨ verificada por IA! ❤️ Candidatura simplificada linkedin!',
    links: [],
  };
  assert.equal(classificar(bot), 'bot_agregador');
});

test('vaga com contato por WhatsApp e cargo no texto é o balde que decide o teste', () => {
  const informal = {
    texto: '🍽️ VAGA ABERTA | GARÇOM(A) 📍 Local: Savassi 📅 Escala: 6x1 Requisitos: experiência mínima',
    links: ['https://wa.me/5531984773056'],
  };
  assert.equal(classificar(informal), 'informal_com_cargo');
});

test('anúncio informal sem cargo é separado, porque o produto busca por cargo', () => {
  // "Vagas abertas no Shopping Boulevard" é informal e é vaga, mas não é
  // alcançável por uma busca de cargo — que é a única busca que o produto tem.
  assert.equal(classificar({ texto: 'Vagas abertas no Shopping Boulevard', links: [] }), 'informal_sem_cargo');
});

test('venda de curso não entra como vaga, mesmo falando de currículo', () => {
  const spam = {
    texto: '🎓 PROMOÇÃO: 5 CURSOS POR R$ 50! Turbine seu currículo com certificados de peso!',
    links: ['https://wa.me/message/SBBIO4U6DT7AL1'],
  };
  assert.equal(classificar(spam), 'spam_curso');
});

/** Bloco real do HTML de `t.me/s/`, reduzido aos campos que o parser lê. */
const BLOCO = `
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="rjempregos/867453">
<div class="tgme_widget_message_text js-message_text" dir="auto">Operador de Caixa - Rede Supermarket<br/><a href="https://rioempregos.com.br/vagasrj/operador-de-caixa-whatsapp/" target="_blank">https://rioempregos.com.br/vagasrj/operador-de-caixa-whatsapp/</a></div>
<a class="tgme_widget_message_link_preview" href="https://rioempregos.com.br/vagasrj/operador-de-caixa-whatsapp"></a>
<div class="tgme_widget_message_footer">
<span class="tgme_widget_message_views">18</span>
<time datetime="2026-08-28T14:03:11+00:00"></time>
</div></div></div>`;

test('extrai id, data, texto e links de um bloco real', () => {
  const mensagens = extrairMensagens(BLOCO, 'rjempregos', 'geral/RJ');
  assert.equal(mensagens.length, 1);
  const m = mensagens[0]!;
  assert.equal(m.id, 867453);
  assert.equal(m.dataIso, '2026-08-28T14:03:11+00:00');
  assert.equal(m.texto, 'Operador de Caixa - Rede Supermarket https://rioempregos.com.br/vagasrj/operador-de-caixa-whatsapp/');
  assert.equal(m.views, 18);
  assert.equal(m.url, 'https://t.me/rjempregos/867453');
  // O card de preview é o destino real quando a mensagem só cola a URL; perder
  // esse link classificaria a republicação como anúncio informal.
  assert.ok(m.links.some((u) => u.includes('operador-de-caixa')));
  assert.equal(classificar(m), 'portal');
});

test('canal fora do ar é falha, não canal vazio', async () => {
  // A lição do achado 24, no eixo do Telegram: carimbar queda de rede como
  // "esse canal não tem vaga" produziria a conclusão errada sobre a fonte.
  const buscar = (async () => {
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch;

  const r = await lerCanal('qualquer', 'teste', 0, buscar);
  assert.equal(r.falhou, true);
  assert.deepEqual(r.mensagens, []);
});

test('HTTP 404 também é falha, e não silêncio', async () => {
  const buscar = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
  const r = await lerCanal('inexistente', 'teste', 0, buscar);
  assert.equal(r.falhou, true);
});
