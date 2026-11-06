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
    headers: { 'x-wagas-extensao': '1', ...(opcoes.headers ?? {}) },
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

function resultado(dados) {
  montar('t-resultado');
  const cv = dados.resultado;

  lista('alertas', dados.alertas, (a) =>
    `${a.tipo === 'empresa' ? 'Empresa: ' : ''}“${a.trecho}”` +
    (a.tipo === 'acrescimo' && a.palavras ? ` — não está no original: ${a.palavras.join(', ')}` : ''),
  );
  lista('mudancas', cv.mudancas);
  lista('lacunas', cv.lacunas);
  document.getElementById('titulo').textContent = cv.titulo ?? '';
  document.getElementById('resumo').textContent = cv.resumo ?? '';

  if (dados.corrigidos > 0) {
    const p = document.getElementById('corrigidos');
    p.textContent = `A IA escreveu ${dados.corrigidos === 1 ? 'um nome' : `${dados.corrigidos} nomes`} de empresa ou cargo com a grafia errada. Voltei para a grafia do seu currículo.`;
    p.hidden = false;
  }

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
      alert(e.message);
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
