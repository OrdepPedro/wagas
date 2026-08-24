type Nivel = 'debug' | 'info' | 'warn' | 'error';

const ORDEM: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function nivelMinimo(): number {
  const bruto = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
  return ORDEM[bruto as Nivel] ?? ORDEM.info;
}

function emitir(nivel: Nivel, msg: string, dados?: Record<string, unknown>): void {
  if (ORDEM[nivel] < nivelMinimo()) return;
  const hora = new Date().toISOString().slice(11, 19);
  const extra = dados && Object.keys(dados).length > 0 ? ' ' + JSON.stringify(dados) : '';
  const linha = `${hora} ${nivel.toUpperCase().padEnd(5)} ${msg}${extra}`;
  if (nivel === 'error' || nivel === 'warn') console.error(linha);
  else console.log(linha);
}

export const log = {
  debug: (msg: string, dados?: Record<string, unknown>) => emitir('debug', msg, dados),
  info: (msg: string, dados?: Record<string, unknown>) => emitir('info', msg, dados),
  warn: (msg: string, dados?: Record<string, unknown>) => emitir('warn', msg, dados),
  error: (msg: string, dados?: Record<string, unknown>) => emitir('error', msg, dados),
};
