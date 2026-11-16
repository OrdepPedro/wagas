// Painel lateral da extensão do wagas.
//
// NÃO lê a página que a pessoa está vendo: ela cola cargo e descrição. Não
// pede permissão de aba nem injeta script em site nenhum (restrição 2 do
// CLAUDE.md: nada de ler o DOM logado do LinkedIn).
//
// Não guarda token: chama o site com o cookie de sessão da pessoa. Quem não
// está logado é mandado para o site.

import { SITE } from './config.js';

const MINIMO = 300; // DESCRICAO_MINIMA em src/curriculo/adaptar.ts
const RASCUNHO = 'rascunho';
const tela = document.getElementById('tela');

let ultimoEstado = null;

function montar(id) {
  document.body.classList.remove('com-chat-aberto', 'com-chat');
  tela.replaceChildren(document.getElementById(id).content.cloneNode(true));
  for (const b of tela.querySelectorAll('[data-abrir]')) {
    b.addEventListener('click', () => chrome.tabs.create({ url: SITE + b.dataset.abrir }));
  }
  for (const b of tela.querySelectorAll('[data-recarregar]')) b.addEventListener('click', iniciar);
}

async function chamar(caminho, opcoes = {}) {
  // `x-wagas-extensao`: o Chrome não manda `Origin` no GET da extensão, então
  // é este cabeçalho que a API usa para saber que o pedido veio daqui.
  return fetch(SITE + caminho, {
    credentials: 'include',
    ...opcoes,
    // `x-wagas-revisao`: este painel confirma antes de baixar; a API só exige
    // a confirmação de quem manda isto (a 0.1.0 não manda).
    headers: { 'x-wagas-extensao': '1', 'x-wagas-revisao': '1', ...(opcoes.headers ?? {}) },
  });
}

async function iniciar() {
  tela.innerHTML = '<p class="fraco">Carregando…</p>';
  let estado;
  try {
    const r = await chamar('/api/extensao/estado');
    if (!r.ok) throw new Error(`o site respondeu ${r.status}`);
    estado = await r.json();
  } catch (e) {
    montar('t-erro-rede');
    document.getElementById('erro-rede-detalhe').textContent = `(${e.message})`;
    return;
  }
  ultimoEstado = estado;
  if (estado.estado === 'sem_sessao' || estado.estado === 'visitante') return montar('t-sem-sessao');
  if (estado.estado === 'sem_curriculo') return montar('t-sem-curriculo');
  if (estado.estado === 'indisponivel') return montar('t-indisponivel');
  await formulario();
}

async function lerRascunho() {
  try {
    return (await chrome.storage.session.get(RASCUNHO))[RASCUNHO] ?? {};
  } catch {
    return {};
  }
}

function salvarRascunho(dados) {
  chrome.storage.session.set({ [RASCUNHO]: dados }).catch(() => {});
}

async function formulario() {
  montar('t-formulario');
  const form = document.getElementById('form');
  const erro = document.getElementById('erro');
  const contador = document.getElementById('contador');
  const enviar = document.getElementById('enviar');
  const restantes = document.getElementById('restantes');

  if (ultimoEstado?.limite) {
    restantes.textContent = `${ultimoEstado.restantes} de ${ultimoEstado.limite} adaptações restantes hoje.`;
  }

  // O rascunho sobrevive a fechar e reabrir o painel (até fechar o navegador).
  const rascunho = await lerRascunho();
  for (const campo of ['cargo', 'empresa', 'descricao']) form[campo].value = rascunho[campo] ?? '';

  const atualizar = () => {
    const n = form.descricao.value.trim().length;
    contador.textContent = n < MINIMO ? `${n} caracteres — cole a descrição completa (mínimo ${MINIMO}).` : `${n} caracteres.`;
    salvarRascunho({ cargo: form.cargo.value, empresa: form.empresa.value, descricao: form.descricao.value });
  };
  form.addEventListener('input', atualizar);
  atualizar();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    if (form.descricao.value.trim().length < MINIMO) {
      erro.textContent = `Cole a descrição completa da vaga (mínimo ${MINIMO} caracteres).`;
      erro.hidden = false;
      return;
    }
    enviar.disabled = true;
    enviar.textContent = 'Adaptando… (leva uns 10 segundos)';
    try {
      const r = await chamar('/api/extensao/adaptar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cargo: form.cargo.value,
          empresa: form.empresa.value,
          descricao: form.descricao.value,
        }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (r.status === 401) return iniciar();
      if (!r.ok) throw new Error(corpo.erro ?? `O site respondeu ${r.status}.`);
      resultado(corpo);
    } catch (e) {
      erro.textContent = e.message === 'Failed to fetch' ? 'Não consegui falar com o wagas. Tente de novo.' : e.message;
      erro.hidden = false;
      enviar.disabled = false;
      enviar.textContent = 'Adaptar meu currículo';
    }
  });
}

function lista(id, itens, formatar = (x) => x) {
  if (!itens?.length) return;
  const caixa = document.getElementById(id);
  const ul = caixa.querySelector('ul');
  for (const item of itens) {
    const li = document.createElement('li');
    li.textContent = formatar(item);
    ul.append(li);
  }
  caixa.hidden = false;
}

function el(tag, texto, classe) {
  const n = document.createElement(tag);
  if (texto) n.textContent = texto;
  if (classe) n.className = classe;
  return n;
}

// A prévia inteira: a pessoa revisa o que vai para o PDF, não um resumo dele.
function previa(cv) {
  const art = document.getElementById('cv');
  art.append(el('h2', cv.nome));
  if (cv.titulo) art.append(el('p', cv.titulo, 'cv-titulo'));
  if (cv.contato?.length) art.append(el('p', cv.contato.join(' · '), 'fraco'));
  if (cv.resumo) art.append(el('h4', 'Resumo'), el('p', cv.resumo));
  if (cv.experiencias?.length) art.append(el('h4', 'Experiência'));
  for (const e of cv.experiencias ?? []) {
    const bloco = el('div', '', 'cv-bloco');
    bloco.append(el('strong', [e.cargo, e.empresa].filter(Boolean).join(' — ')));
    if (e.periodo) bloco.append(el('span', ` · ${e.periodo}`, 'fraco'));
    const ul = el('ul');
    for (const item of e.itens ?? []) ul.append(el('li', item));
    bloco.append(ul);
    art.append(bloco);
  }
  if (cv.formacao?.length) art.append(el('h4', 'Formação'));
  for (const f of cv.formacao ?? []) {
    const p = el('p');
    p.append(el('strong', [f.curso, f.instituicao].filter(Boolean).join(' — ')));
    if (f.periodo) p.append(el('span', ` · ${f.periodo}`, 'fraco'));
    art.append(p);
  }
  for (const [titulo, itens] of [
    ['Habilidades', cv.habilidades],
    ['Certificações', cv.certificacoes],
    ['Idiomas', cv.idiomas],
  ]) {
    if (itens?.length) art.append(el('h4', titulo), el('p', itens.join(' · ')));
  }
}

function conversa(mensagens) {
  const ol = document.getElementById('conversa');
  for (const m of mensagens ?? []) {
    if (m.manual) {
      ol.append(el('li', 'Você editou o currículo à mão.', 'conversa-nota'));
      continue;
    }
    const li = el('li');
    li.append(el('p', m.pedido, 'conversa-pedido'));
    const r = el('p', m.resposta, 'conversa-resposta');
    if (!m.mudou) r.append(el('span', ' (o currículo não mudou)', 'fraco'));
    li.append(r);
    ol.append(li);
  }
  ol.hidden = !mensagens?.length;
  document.getElementById('chat-dica').hidden = Boolean(mensagens?.length);
  const rolagem = document.getElementById('chat-rolagem');
  rolagem.scrollTop = rolagem.scrollHeight;
}

// Aberto ou minimizado sobrevive às re-renderizações da revisão.
let chatAberto = true;

function alternarChat() {
  document.getElementById('chat-corpo').hidden = !chatAberto;
  document.getElementById('alternar-chat').setAttribute('aria-expanded', String(chatAberto));
  document.getElementById('seta-chat').textContent = chatAberto ? '▾' : '▴';
  document.body.classList.add('com-chat');
  document.body.classList.toggle('com-chat-aberto', chatAberto);
}

// Edição manual: o currículo vira formulário, uma linha por item nas listas.
function campo(rotulo, valor, longo) {
  const label = el('label', rotulo);
  const entrada = el(longo ? 'textarea' : 'input');
  if (longo) entrada.rows = Math.min(Math.max(String(valor).split('\n').length + 1, 2), 10);
  entrada.value = valor ?? '';
  label.append(entrada);
  return { label, ler: () => entrada.value };
}

const linhas = (texto) => texto.split('\n').map((l) => l.trim()).filter(Boolean);

function editor(dados) {
  const cv = dados.resultado;
  const form = document.getElementById('editor');
  form.replaceChildren();
  const leitores = {};
  const simples = [
    ['nome', 'Nome', cv.nome, false],
    ['titulo', 'Título', cv.titulo, false],
    ['contato', 'Contato (um por linha)', (cv.contato ?? []).join('\n'), true],
    ['resumo', 'Resumo', cv.resumo, true],
  ];
  for (const [chave, rotulo, valor, longo] of simples) {
    const c = campo(rotulo, valor, longo);
    form.append(c.label);
    leitores[chave] = c.ler;
  }

  const blocos = (titulo, itens, novo, campos) => {
    form.append(el('h4', titulo));
    const caixa = el('div');
    const lidos = [];
    const adicionar = (item) => {
      const fs = el('fieldset');
      const ls = campos.map(([chave, rotulo, longo]) => {
        const valor = Array.isArray(item[chave]) ? item[chave].join('\n') : item[chave];
        const c = campo(rotulo, valor, longo);
        fs.append(c.label);
        return [chave, c.ler, longo];
      });
      const leitor = () =>
        Object.fromEntries(ls.map(([chave, ler, longo]) => [chave, longo ? linhas(ler()) : ler()]));
      lidos.push(leitor);
      const remover = el('button', 'Remover', 'link remover');
      remover.type = 'button';
      remover.addEventListener('click', () => {
        lidos.splice(lidos.indexOf(leitor), 1);
        fs.remove();
      });
      fs.append(remover);
      caixa.append(fs);
    };
    for (const item of itens ?? []) adicionar(item);
    const mais = el('button', `+ ${titulo}`, 'link');
    mais.type = 'button';
    mais.addEventListener('click', () => adicionar(novo));
    form.append(caixa, mais);
    return () => lidos.map((ler) => ler());
  };

  const lerExp = blocos('Experiência', cv.experiencias, { cargo: '', empresa: '', periodo: '', itens: [] }, [
    ['cargo', 'Cargo', false],
    ['empresa', 'Empresa', false],
    ['periodo', 'Período', false],
    ['itens', 'O que você fez (um por linha)', true],
  ]);
  const lerForm = blocos('Formação', cv.formacao, { curso: '', instituicao: '', periodo: '' }, [
    ['curso', 'Curso', false],
    ['instituicao', 'Instituição', false],
    ['periodo', 'Período', false],
  ]);

  form.append(el('h4', 'Outros'));
  for (const [chave, rotulo] of [
    ['habilidades', 'Habilidades (uma por linha)'],
    ['certificacoes', 'Certificações (uma por linha)'],
    ['idiomas', 'Idiomas (um por linha)'],
  ]) {
    const c = campo(rotulo, (cv[chave] ?? []).join('\n'), true);
    form.append(c.label);
    leitores[chave] = () => linhas(c.ler());
  }

  const erro = el('p', '', 'erro');
  erro.hidden = true;
  const salvar = el('button', 'Salvar edição', 'botao');
  salvar.type = 'submit';
  const cancelar = el('button', 'Cancelar', 'link');
  cancelar.type = 'button';
  cancelar.addEventListener('click', () => resultado(dados));
  const acoes = el('div', '', 'acoes');
  acoes.append(salvar, cancelar);
  form.append(erro, acoes);

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    salvar.disabled = true;
    salvar.textContent = 'Salvando…';
    const editado = {
      nome: leitores.nome(),
      titulo: leitores.titulo(),
      contato: linhas(leitores.contato()),
      resumo: leitores.resumo(),
      experiencias: lerExp(),
      formacao: lerForm(),
      habilidades: leitores.habilidades(),
      certificacoes: leitores.certificacoes(),
      idiomas: leitores.idiomas(),
    };
    try {
      const novo = await enviarJson(`/api/extensao/adaptacoes/${dados.id}/editar`, { curriculo: editado });
      if (novo) resultado(novo, 'cv');
    } catch (e) {
      erro.textContent = mensagemDeErro(e);
      erro.hidden = false;
      salvar.disabled = false;
      salvar.textContent = 'Salvar edição';
    }
  };

  document.getElementById('cv').hidden = true;
  document.getElementById('editar').hidden = true;
  form.hidden = false;
  form.scrollIntoView({ block: 'start' });
}

async function enviarJson(caminho, corpo) {
  const r = await chamar(caminho, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401) {
    await iniciar();
    return null;
  }
  if (!r.ok) throw new Error(dados.erro ?? `O site respondeu ${r.status}.`);
  return dados;
}

function mensagemDeErro(e) {
  return e.message === 'Failed to fetch' ? 'Não consegui falar com o wagas. Tente de novo.' : e.message;
}

// Revisão: lê, ajusta pelo chat, confirma — e só então baixa.
function resultado(dados, foco) {
  // Re-renderizar depois de um ajuste não pode jogar a pessoa de volta ao topo.
  const rolagemAntes = window.scrollY;
  montar('t-resultado');
  const cv = dados.resultado;
  alternarChat();
  document.getElementById('alternar-chat').addEventListener('click', () => {
    chatAberto = !chatAberto;
    alternarChat();
  });
  document.getElementById('editar').addEventListener('click', () => editor(dados));

  lista('alertas', dados.alertas, (a) =>
    `${a.tipo === 'empresa' ? 'Empresa: ' : ''}“${a.trecho}”` +
    (a.tipo === 'acrescimo' && a.palavras ? ` — não está no original: ${a.palavras.join(', ')}` : ''),
  );
  lista('mudancas', cv.mudancas);
  lista('lacunas', cv.lacunas);
  previa(cv);
  conversa(dados.conversa);

  if (dados.corrigidos > 0) {
    const p = document.getElementById('corrigidos');
    p.textContent = `A IA escreveu ${dados.corrigidos === 1 ? 'um nome' : `${dados.corrigidos} nomes`} de empresa ou cargo com a grafia errada. Voltei para a grafia do seu currículo.`;
    p.hidden = false;
  }

  const form = document.getElementById('form-ajuste');
  const erroAjuste = document.getElementById('erro-ajuste');
  const enviar = document.getElementById('enviar-ajuste');
  document.getElementById('ajustes-restantes').textContent =
    `${dados.ajustesRestantes} de ${dados.limiteAjustes} ajustes restantes hoje.`;
  if (dados.ajustesRestantes === 0) {
    form.pedido.disabled = true;
    enviar.disabled = true;
  }
  form.pedido.addEventListener('keydown', (ev) => {
    // Enter envia, Shift+Enter quebra linha.
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erroAjuste.hidden = true;
    enviar.disabled = true;
    form.pedido.readOnly = true;
    enviar.textContent = 'A IA está ajustando… uns 15 segundos';
    try {
      const novo = await enviarJson(`/api/extensao/adaptacoes/${dados.id}/corrigir`, { pedido: form.pedido.value });
      if (novo) resultado(novo);
    } catch (e) {
      erroAjuste.textContent = mensagemDeErro(e);
      erroAjuste.hidden = false;
      enviar.disabled = false;
      form.pedido.readOnly = false;
      enviar.textContent = 'Pedir ajuste';
    }
  });

  document.getElementById('nao-confirmada').hidden = dados.confirmada;
  document.getElementById('ja-confirmada').hidden = !dados.confirmada;
  document.getElementById('confirmacao').classList.toggle('boa', dados.confirmada);

  const confirmar = document.getElementById('confirmar');
  confirmar.addEventListener('click', async () => {
    confirmar.disabled = true;
    try {
      const novo = await enviarJson(`/api/extensao/adaptacoes/${dados.id}/confirmar`, { versao: dados.versao });
      if (novo) resultado(novo, 'confirmacao');
    } catch (e) {
      alert(mensagemDeErro(e));
      confirmar.disabled = false;
    }
  });

  if (foco) document.getElementById(foco)?.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, rolagemAntes);

  const baixar = document.getElementById('baixar');
  baixar.addEventListener('click', async () => {
    baixar.disabled = true;
    try {
      const r = await chamar(`/api/extensao/adaptacoes/${dados.id}/pdf`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro ?? `O site respondeu ${r.status}.`);
      const nome = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'curriculo.pdf';
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: nome });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      alert(mensagemDeErro(e));
    } finally {
      baixar.disabled = false;
    }
  });

  document.getElementById('outra').addEventListener('click', async () => {
    salvarRascunho({});
    await iniciar();
  });
}

for (const b of document.querySelectorAll('[data-abrir-fixo]')) {
  b.addEventListener('click', () => chrome.tabs.create({ url: SITE + b.dataset.abrirFixo }));
}

iniciar();
