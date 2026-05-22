export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  off: 99,
};

function configuredLevel(): LogLevel {
  const raw = (process.env.RUBYNOD_LOG_LEVEL ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'off') {
    return raw;
  }
  return 'info';
}

function shouldLog(level: Exclude<LogLevel, 'off'>): boolean {
  const cfg = configuredLevel();
  if (cfg === 'off') return false;
  return LEVEL_RANK[level] >= LEVEL_RANK[cfg];
}

function truncate(value: unknown, max = 1200): string {
  if (value === undefined) return '';
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (${s.length} chars)`;
}

function write(level: Exclude<LogLevel, 'off'>, area: string, message: string, detail?: unknown): void {
  if (!shouldLog(level)) return;
  const extra = detail !== undefined ? ` ${truncate(detail)}` : '';
  const line = `[rubynod-ai] [${area}] ${level.toUpperCase()} ${message}${extra}`;
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.error(line);
  }
}

export const serverLog = {
  debug: (message: string, detail?: unknown) => write('debug', 'server', message, detail),
  info: (message: string, detail?: unknown) => write('info', 'server', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', 'server', message, detail),
  error: (message: string, detail?: unknown) => write('error', 'server', message, detail),
};

export const agentLog = {
  debug: (message: string, detail?: unknown) => write('debug', 'agent', message, detail),
  info: (message: string, detail?: unknown) => write('info', 'agent', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', 'agent', message, detail),
  error: (message: string, detail?: unknown) => write('error', 'agent', message, detail),
};

export const toolLog = {
  debug: (message: string, detail?: unknown) => write('debug', 'tool', message, detail),
  info: (message: string, detail?: unknown) => write('info', 'tool', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', 'tool', message, detail),
  error: (message: string, detail?: unknown) => write('error', 'tool', message, detail),
};
