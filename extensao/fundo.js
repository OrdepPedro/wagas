// Clique no ícone abre o painel lateral. Painel lateral, e não popup: o popup
// fecha quando a pessoa clica na página para copiar a descrição da vaga.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
