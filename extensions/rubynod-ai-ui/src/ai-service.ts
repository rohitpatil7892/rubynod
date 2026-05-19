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

function isRubynodRepoRoot(root: string): boolean {
  return (
    fs.existsSync(path.join(root, 'packages', 'rubynod-ai', 'package.json')) &&
    fs.existsSync(path.join(root, 'scripts', 'run-ai.mjs'))
  );
}

function findRubynodRepoRoot(): string | undefined {
  const configured = vscode.workspace.getConfiguration('rubynod').get<string>('ai.repoPath', '').trim();
  if (configured && isRubynodRepoRoot(configured)) return configured;

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const f of folders) {
    const root = f.uri.fsPath;
    if (isRubynodRepoRoot(root)) return root;
  }

  const fromExt = path.resolve(__dirname, '..', '..', '..');
  if (isRubynodRepoRoot(fromExt)) return fromExt;

  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    const guesses = [
      path.join(home, 'rubynod'),
      path.join(home, 'Desktop', 'myCode', 'rubynod'),
      path.join(home, 'Documents', 'rubynod'),
    ];
    for (const g of guesses) {
      if (isRubynodRepoRoot(g)) return g;
    }
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
    const learn = 'How it works';
    const pick = await vscode.window.showWarningMessage(
      'Rubynod needs a local AI agent service (port 3847). It is not the same as Ollama alone — Ollama only provides the model; the agent runs from a Rubynod git clone.',
      learn,
      'Choose folder…'
    );
    if (pick === learn) {
      void vscode.window.showInformationMessage(
        'Flow: VS Code extension → Rubynod AI service (:3847) → Ollama (:11434).\n\n' +
          'Clone once: github.com/rohitpatil7892/rubynod\n' +
          'Then: npm install && npm run build && Rubynod: Start AI Service.\n\n' +
          'Set rubynod.ai.repoPath in Settings so you are not asked again.'
      );
      return;
    }
    if (pick !== 'Choose folder…') return;

    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Rubynod repo',
      title: 'Select the folder where you cloned rubynod (contains packages/rubynod-ai)',
    });
    if (!picked?.[0]) return;
    root = picked[0].fsPath;
    if (!isRubynodRepoRoot(root)) {
      vscode.window.showErrorMessage(
        'That folder is not a Rubynod repo. Clone github.com/rohitpatil7892/rubynod and select that folder.'
      );
      return;
    }
    await vscode.workspace
      .getConfiguration('rubynod')
      .update('ai.repoPath', root, vscode.ConfigurationTarget.Global);
  }

  const term = vscode.window.createTerminal({ name: 'Rubynod AI', cwd: root });
  term.show();
  term.sendText('npm run start:ai');
  vscode.window.showInformationMessage(
    'Starting Rubynod AI agent on http://127.0.0.1:3847 (uses your Ollama models). Wait for the terminal message, then chat again.'
  );
}

export function formatAiConnectionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const url = getServiceUrl();
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|Failed to fetch/i.test(msg)) {
    return (
      `Cannot reach Rubynod AI at ${url}.\n\n` +
      `The extension does not talk to Ollama directly. You need:\n` +
      `1. Ollama running (ollama serve)\n` +
      `2. Rubynod AI agent service (Cmd+Shift+P → Rubynod: Start AI Service)\n\n` +
      `One-time: clone rubynod and set rubynod.ai.repoPath in Settings.`
    );
  }
  return `${msg}\n\nAI service: ${url}`;
}
