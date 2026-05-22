import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogArea = 'ext' | 'ai' | 'agent' | 'bridge' | 'chat' | 'webview';

const CHANNEL_NAME = 'Rubynod';
const LEVEL_RANK: Record<LogLevel | 'off', number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  off: 99,
};

let channel: vscode.OutputChannel | undefined;

export function getRubynodLogLevel(): LogLevel | 'off' {
  const v = vscode.workspace.getConfiguration('rubynod').get<string>('logging.level', 'info');
  if (v === 'off' || v === 'error' || v === 'warn' || v === 'info' || v === 'debug') return v;
  return 'info';
}

/** Level passed to bundled AI child process (RUBYNOD_LOG_LEVEL). */
export function getServerLogLevel(): LogLevel | 'off' {
  const ext = getRubynodLogLevel();
  return ext === 'off' ? 'off' : ext;
}

function shouldLog(level: LogLevel): boolean {
  const cfg = getRubynodLogLevel();
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

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

export function showRubynodOutput(preserveFocus = true): void {
  channel ??= vscode.window.createOutputChannel(CHANNEL_NAME);
  channel.show(preserveFocus);
}

function append(area: LogArea, level: LogLevel, message: string, detail?: unknown): void {
  if (!shouldLog(level)) return;
  channel ??= vscode.window.createOutputChannel(CHANNEL_NAME);
  const extra = detail !== undefined ? ` ${truncate(detail)}` : '';
  const line = `${timestamp()} [${area}] ${level.toUpperCase()} ${message}${extra}`;
  channel.appendLine(line);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else if (getRubynodLogLevel() === 'debug') {
    console.log(line);
  }
  if (
    level === 'error' &&
    vscode.workspace.getConfiguration('rubynod').get<boolean>('logging.showOnError', true)
  ) {
    channel.show(true);
  }
}

function areaLogger(area: LogArea) {
  return {
    debug: (message: string, detail?: unknown) => append(area, 'debug', message, detail),
    info: (message: string, detail?: unknown) => append(area, 'info', message, detail),
    warn: (message: string, detail?: unknown) => append(area, 'warn', message, detail),
    error: (message: string, detail?: unknown) => append(area, 'error', message, detail),
  };
}

export const extLog = areaLogger('ext');
export const aiLog = areaLogger('ai');
export const agentLog = areaLogger('agent');
export const bridgeLog = areaLogger('bridge');
export const chatLog = areaLogger('chat');
export const webviewLog = areaLogger('webview');
