/**
 * A cota diária da Custom Search JSON API zera à meia-noite do Pacífico (fuso do
 * Google Cloud), não à meia-noite de Brasília nem em UTC. Contar por dia local
 * daria dois "dias" dentro da mesma janela de cota e estouraria o limite de 100.
 */
const FORMATADOR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Chave de cota no formato YYYY-MM-DD, no fuso do Pacífico. */
export function diaQuota(momento: Date = new Date()): string {
  return FORMATADOR.format(momento);
}
