import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aiLog, getServerLogLevel } from './logger';

/**
 * TS with `"module": "commonjs"` compiles `import(url)` to `require(url)`, which fails
 * for file:// ESM bundles in the VS Code extension host. Use native dynamic import().
 */
async function importEsmModule<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function(
    'specifier',
    'return import(specifier)'
  ) as (s: string) => Promise<T>;
  return dynamicImport(specifier);
}

type ServerModule = {
  startRubynodServer: (opts?: { port?: number; host?: string }) => Promise<unknown>;
  stopRubynodServer: () => Promise<void>;
};

let serverModule: ServerModule | undefined;
let inProcess = false;
let lastStartError: string | undefined;

export function getInProcessStartError(): string | undefined {
  return lastStartError;
}

export function isInProcessServer(): boolean {
  return inProcess;
}

export function getBundledServerEntry(extensionPath: string): string | undefined {
  const entry = path.join(extensionPath, 'server', 'dist', 'server.js');
  return fs.existsSync(entry) ? entry : undefined;
}

/**
 * Start the AI HTTP server inside the VS Code extension host (no separate Node process).
 */
export async function startInProcessServer(
  extensionPath: string,
  port: number,
  host = '127.0.0.1'
): Promise<boolean> {
  const entry = getBundledServerEntry(extensionPath);
  if (!entry) {
    lastStartError = 'Bundled server entry not found (reinstall extension or run bundle:server)';
    return false;
  }

  try {
    const serverDir = path.join(extensionPath, 'server');
    process.env.RUBYNOD_SERVER_ROOT = serverDir;
    process.env.RUBYNOD_SQL_WASM_DIR = path.join(serverDir, 'dist');

    if (!serverModule) {
      const prevCwd = process.cwd();
      try {
        process.chdir(serverDir);
        serverModule = await importEsmModule<ServerModule>(pathToFileURL(entry).href);
      } finally {
        process.chdir(prevCwd);
      }
    }

    process.env.RUBYNOD_AI_PORT = String(port);
    process.env.RUBYNOD_AI_HOST = host;
    const logLevel = getServerLogLevel();
    if (logLevel !== 'off') {
      process.env.RUBYNOD_LOG_LEVEL = logLevel;
    }

    aiLog.info('In-process server starting', { port, host, logLevel });
    await serverModule.startRubynodServer({ port, host });
    aiLog.info('In-process server listening', { port, host });
    inProcess = true;
    lastStartError = undefined;
    return true;
  } catch (err) {
    serverModule = undefined;
    inProcess = false;
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    lastStartError = msg;
    aiLog.error('In-process server failed', msg);
    return false;
  }
}

export async function stopInProcessServer(): Promise<void> {
  if (!serverModule || !inProcess) return;
  try {
    await serverModule.stopRubynodServer();
  } catch {
    // ignore shutdown errors
  }
  serverModule = undefined;
  inProcess = false;
}
