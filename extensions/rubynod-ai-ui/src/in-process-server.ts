import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

type ServerModule = {
  startRubynodServer: (opts?: { port?: number; host?: string }) => Promise<unknown>;
  stopRubynodServer: () => Promise<void>;
};

let serverModule: ServerModule | undefined;
let inProcess = false;

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
  if (!entry) return false;

  try {
    if (!serverModule) {
      const serverDir = path.join(extensionPath, 'server');
      const prevCwd = process.cwd();
      try {
        process.chdir(serverDir);
        serverModule = (await import(pathToFileURL(entry).href)) as ServerModule;
      } finally {
        process.chdir(prevCwd);
      }
    }

    process.env.RUBYNOD_AI_PORT = String(port);
    process.env.RUBYNOD_AI_HOST = host;

    await serverModule.startRubynodServer({ port, host });
    inProcess = true;
    return true;
  } catch (err) {
    serverModule = undefined;
    inProcess = false;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[rubynod-ai-ui] in-process server failed:', msg);
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
