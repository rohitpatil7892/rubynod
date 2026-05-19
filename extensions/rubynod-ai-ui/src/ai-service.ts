import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getServiceUrl } from './settings';

export async function isAiServiceHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${getServiceUrl()}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findRubynodRepoRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const f of folders) {
    const root = f.uri.fsPath;
    const pkg = path.join(root, 'package.json');
    if (!fs.existsSync(pkg)) continue;
    try {
      const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name as string;
      if (name === 'rubynod' && fs.existsSync(path.join(root, 'packages', 'rubynod-ai'))) {
        return root;
      }
    } catch {
      /* skip */
    }
  }
  const fromExt = path.resolve(__dirname, '..', '..', '..');
  if (fs.existsSync(path.join(fromExt, 'packages', 'rubynod-ai', 'package.json'))) {
    return fromExt;
  }
  const configured = vscode.workspace.getConfiguration('rubynod').get<string>('ai.repoPath', '');
  if (configured && fs.existsSync(path.join(configured, 'packages', 'rubynod-ai'))) {
    return configured;
  }
  return undefined;
}

export async function startAiService(): Promise<void> {
  if (await isAiServiceHealthy()) {
    vscode.window.showInformationMessage(`Rubynod AI is already running at ${getServiceUrl()}`);
    return;
  }

  let root = findRubynodRepoRoot();
  if (!root) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Rubynod repo folder',
      title: 'Where is your rubynod clone? (contains packages/rubynod-ai)',
    });
    if (!picked?.[0]) return;
    root = picked[0].fsPath;
    await vscode.workspace
      .getConfiguration('rubynod')
      .update('ai.repoPath', root, vscode.ConfigurationTarget.Global);
  }

  const term = vscode.window.createTerminal({ name: 'Rubynod AI', cwd: root });
  term.show();
  term.sendText('npm run start:ai');
  vscode.window.showInformationMessage(
    'Starting Rubynod AI in the terminal. Wait for "listening on 127.0.0.1:3847", then send your message again.'
  );
}

export function formatAiConnectionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const url = getServiceUrl();
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|Failed to fetch/i.test(msg)) {
    return `Cannot reach Rubynod AI at ${url}.\n\nThe local agent service is not running.\n\n1. Cmd+Shift+P → **Rubynod: Start AI Service**\n2. Or in a terminal: \`cd <rubynod-repo> && npm run start:ai\`\n3. Reload the window, then try chat again.`;
  }
  return `${msg}\n\nAI service: ${url}`;
}
