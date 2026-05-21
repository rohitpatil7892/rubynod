import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getServiceUrl } from './settings';
import {
  getBundledServerEntry,
  getInProcessStartError,
  isInProcessServer,
  startInProcessServer,
  stopInProcessServer,
} from './in-process-server';

const HEALTH_POLL_MS = 400;
const HEALTH_TIMEOUT_MS = 45_000;
const DEFAULT_PORT = 3847;

let serverProcess: ChildProcess | undefined;
let startingPromise: Promise<boolean> | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function log(line: string): void {
  outputChannel ??= vscode.window.createOutputChannel('Rubynod AI Service');
  outputChannel.appendLine(line);
}

export { getBundledServerEntry };

export async function isAiServiceHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${getServiceUrl()}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAiServiceHealthy()) return true;
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

function parseServicePort(): number {
  try {
    const u = new URL(getServiceUrl());
    return u.port ? Number(u.port) : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

function parseServiceHost(): string {
  try {
    return new URL(getServiceUrl()).hostname || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

async function findNodeExecutable(): Promise<string> {
  const configured = vscode.workspace.getConfiguration('rubynod').get<string>('ai.nodePath', '').trim();
  if (configured && fs.existsSync(configured)) return configured;

  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles ?? '', 'nodejs', 'node.exe'),
          path.join(process.env['ProgramFiles(x86)'] ?? '', 'nodejs', 'node.exe'),
        ]
      : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'node';
}

function isRubynodRepoRoot(root: string): boolean {
  return (
    fs.existsSync(path.join(root, 'packages', 'rubynod-ai', 'package.json')) &&
    fs.existsSync(path.join(root, 'scripts', 'run-ai.mjs'))
  );
}

function findRubynodRepoRoot(): string | undefined {
  const configured = vscode.workspace.getConfiguration('rubynod').get<string>('ai.repoPath', '').trim();
  if (configured && isRubynodRepoRoot(configured)) return configured;

  for (const f of vscode.workspace.workspaceFolders ?? []) {
    if (isRubynodRepoRoot(f.uri.fsPath)) return f.uri.fsPath;
  }

  const fromExt = path.resolve(__dirname, '..', '..', '..', '..');
  if (isRubynodRepoRoot(fromExt)) return fromExt;

  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    for (const g of [
      path.join(home, 'rubynod'),
      path.join(home, 'Desktop', 'myCode', 'rubynod'),
      path.join(home, 'Documents', 'rubynod'),
    ]) {
      if (isRubynodRepoRoot(g)) return g;
    }
  }
  return undefined;
}

/** Phase 2: run agent inside the extension host (no system Node required). */
async function startInProcess(extensionPath: string): Promise<boolean> {
  const port = parseServicePort();
  const host = parseServiceHost();
  log(`Starting in-process AI service on http://${host}:${port}`);
  const ok = await startInProcessServer(extensionPath, port, host);
  if (!ok) {
    log('In-process start failed.');
    return false;
  }
  return waitForHealthy(15_000);
}

/** Phase 1 fallback: child process with system Node. */
async function spawnBundledServer(extensionPath: string): Promise<boolean> {
  const entry = getBundledServerEntry(extensionPath);
  if (!entry) return false;

  if (serverProcess && !serverProcess.killed) {
    return waitForHealthy();
  }

  const node = await findNodeExecutable();
  const serverDir = path.join(extensionPath, 'server');
  const port = String(parseServicePort());

  log(`Starting bundled AI service (child process): ${node} ${entry}`);

  serverProcess = spawn(node, [entry], {
    cwd: serverDir,
    env: {
      ...process.env,
      RUBYNOD_AI_PORT: port,
      RUBYNOD_AI_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Survive extension-host reloads (Developer: Reload Window) so port 3847 stays up.
    detached: process.platform !== 'win32',
  });

  serverProcess.stdout?.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split('\n').filter(Boolean)) log(`[stdout] ${line}`);
  });
  serverProcess.stderr?.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split('\n').filter(Boolean)) log(`[stderr] ${line}`);
  });
  serverProcess.on('exit', (code, signal) => {
    log(`AI service exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    serverProcess = undefined;
  });
  serverProcess.on('error', (err) => {
    log(`AI service process error: ${err.message}`);
    serverProcess = undefined;
  });
  if (serverProcess.pid) {
    log(`AI service PID ${serverProcess.pid} (survives window reload)`);
  }
  serverProcess.unref();

  return waitForHealthy();
}

async function startFromRepoFallback(): Promise<boolean> {
  const root = findRubynodRepoRoot();
  if (!root) return false;

  const entry = path.join(root, 'packages', 'rubynod-ai', 'dist', 'server.js');
  if (!fs.existsSync(entry)) return false;

  const node = await findNodeExecutable();
  const port = String(parseServicePort());
  log(`Starting dev AI service from repo: ${entry}`);

  serverProcess = spawn(node, [entry], {
    cwd: root,
    env: { ...process.env, RUBYNOD_AI_PORT: port, RUBYNOD_AI_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  serverProcess.stdout?.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split('\n').filter(Boolean)) log(`[stdout] ${line}`);
  });
  serverProcess.stderr?.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split('\n').filter(Boolean)) log(`[stderr] ${line}`);
  });
  serverProcess.on('exit', () => {
    serverProcess = undefined;
  });
  serverProcess.unref();

  return waitForHealthy();
}

/**
 * Ensure the local AI agent is running.
 * Phase 2: in-process (default) → child-process bundle → monorepo dev fallback.
 */
export async function ensureAiServiceStarted(extensionPath: string): Promise<boolean> {
  if (await isAiServiceHealthy()) {
    log(`Reusing AI service already listening at ${getServiceUrl()}`);
    return true;
  }
  if (startingPromise) return startingPromise;

  const useInProcess = vscode.workspace
    .getConfiguration('rubynod')
    .get<boolean>('ai.inProcess', false);

  startingPromise = (async () => {
    if (useInProcess && getBundledServerEntry(extensionPath)) {
      if (await startInProcess(extensionPath)) return true;
      const detail = getInProcessStartError();
      log(
        detail
          ? `In-process start failed:\n${detail}\nFalling back to child-process server start…`
          : 'In-process start failed. Falling back to child-process server start…'
      );
    }
    if (await spawnBundledServer(extensionPath)) return true;
    if (await startFromRepoFallback()) return true;
    return false;
  })();

  try {
    return await startingPromise;
  } finally {
    startingPromise = undefined;
  }
}

export async function startAiService(extensionPath: string): Promise<void> {
  if (await isAiServiceHealthy()) {
    vscode.window.showInformationMessage(`Rubynod AI is already running at ${getServiceUrl()}`);
    return;
  }

  if (await ensureAiServiceStarted(extensionPath)) {
    const mode = isInProcessServer() ? 'in-process' : 'child process';
    vscode.window.showInformationMessage(
      `Rubynod AI service started at ${getServiceUrl()} (${mode})`
    );
    return;
  }

  const bundled = getBundledServerEntry(extensionPath);
  if (!bundled) {
    const build = 'Build bundled server';
    const pick = await vscode.window.showWarningMessage(
      'Rubynod AI service is not bundled. Run `npm run bundle:server` in the rubynod repo, or select a dev clone.',
      build,
      'Choose repo folder…'
    );
    if (pick === build) {
      void vscode.window.showInformationMessage(
        'From the rubynod repo: npm run build && npm run bundle:server — then reload the window.'
      );
      return;
    }
    if (pick === 'Choose repo folder…') {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Rubynod repo',
      });
      if (!picked?.[0]) return;
      const root = picked[0].fsPath;
      if (!isRubynodRepoRoot(root)) {
        vscode.window.showErrorMessage('That folder is not a Rubynod repo.');
        return;
      }
      await vscode.workspace
        .getConfiguration('rubynod')
        .update('ai.repoPath', root, vscode.ConfigurationTarget.Global);
      if ((await startFromRepoFallback()) && (await isAiServiceHealthy())) {
        vscode.window.showInformationMessage(`Rubynod AI service started at ${getServiceUrl()}`);
        return;
      }
    }
    return;
  }

  outputChannel?.show(true);
  vscode.window.showErrorMessage(
    'Rubynod could not start the AI service. Open Output → Rubynod AI Service for details.'
  );
}

export async function stopAiService(): Promise<void> {
  if (isInProcessServer()) {
    log('Stopping in-process AI service…');
    await stopInProcessServer();
  }
  if (serverProcess && !serverProcess.killed) {
    log('Stopping child-process AI service…');
    serverProcess.kill();
    serverProcess = undefined;
  }
}

export function formatAiConnectionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const url = getServiceUrl();
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|Failed to fetch/i.test(msg)) {
    return (
      `Cannot reach Rubynod AI at ${url}.\n\n` +
      `The extension starts the AI agent automatically (in-process, no separate Node install).\n` +
      `For local models, run Ollama (ollama serve).\n` +
      `Cmd+Shift+P → Rubynod: Start AI Service to retry.\n\n` +
      `Check Output → Rubynod AI Service for logs.`
    );
  }
  return `${msg}\n\nAI service: ${url}`;
}
