import type { IdeBridge } from './types.js';

let bridgeUrl: string | undefined;

export function setBridgeUrl(url: string | undefined): void {
  bridgeUrl = url;
}

export function getBridgeUrl(): string | undefined {
  return bridgeUrl;
}

async function callBridge<T>(method: string, args: unknown[]): Promise<T> {
  if (!bridgeUrl) throw new Error('IDE bridge not connected');
  const res = await fetch(`${bridgeUrl}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  const json = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? `Bridge call failed: ${method}`);
  return json.result as T;
}

export function createHttpIdeBridge(): IdeBridge {
  return {
    readFile: (path, offset, limit) => callBridge('readFile', [path, offset, limit]),
    writeFile: (path, content) => callBridge('writeFile', [path, content]),
    searchReplace: (path, oldStr, newStr, replaceAll) =>
      callBridge('searchReplace', [path, oldStr, newStr, replaceAll]),
    glob: (pattern, cwd) => callBridge('glob', [pattern, cwd]),
    grep: (pattern, searchPath) => callBridge('grep', [pattern, searchPath]),
    listDir: (path) => callBridge('listDir', [path]),
    runTerminal: (command, cwd, blockUntilMs) =>
      callBridge('runTerminal', [command, cwd, blockUntilMs]),
    readLints: (paths) => callBridge('readLints', [paths]),
    getOpenEditors: () => callBridge('getOpenEditors', []),
    getSelection: () => callBridge('getSelection', []),
    getTerminalBuffer: () => callBridge('getTerminalBuffer', []),
    getGitContext: () => callBridge('getGitContext', []),
    findDefinition: (fileUri, line, character) =>
      callBridge('findDefinition', [fileUri, line, character]),
    findReferences: (fileUri, line, character) =>
      callBridge('findReferences', [fileUri, line, character]),
    getDocumentSymbols: (fileUri) =>
      callBridge('getDocumentSymbols', [fileUri]),
  };
}
