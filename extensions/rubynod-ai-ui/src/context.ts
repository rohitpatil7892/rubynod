import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getServiceUrl, getWorkspaceRoot } from './settings';
import { createIdeBridge } from './bridge';
import { attachmentFromFile } from './file-context';
import { attachmentFromFolder } from './folder-context';

export interface ContextAttachment {
  type: string;
  label: string;
  content: string;
  /** Source path for file attachments (used for chips / citations). */
  path?: string;
  startLine?: number;
  endLine?: number;
}

export async function resolveMention(
  mention: string,
  query?: string
): Promise<ContextAttachment | null> {
  const ws = getWorkspaceRoot();
  const bridge = createIdeBridge();

  if (mention === 'selection') {
    const content = (await bridge.getSelection!()) as string;
    return { type: 'selection', label: 'Current selection', content };
  }

  if (mention === 'open') {
    const content = (await bridge.getOpenEditors!()) as string;
    return { type: 'open', label: 'Open editors', content };
  }

  if (mention === 'terminal') {
    const content = (await bridge.getTerminalBuffer!()) as string;
    return { type: 'terminal', label: 'Terminal output', content };
  }

  if (mention === 'git') {
    const content = (await bridge.getGitContext!()) as string;
    return { type: 'git', label: 'Git context', content };
  }

  if (mention === 'codebase' && query) {
    const res = await fetch(`${getServiceUrl()}/index/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws, query, limit: 12 }),
    });
    const json = (await res.json()) as { formatted: string; summary: string };
    return {
      type: 'codebase',
      label: `@codebase: ${query}`,
      content: json.formatted || '(index empty — run Rubynod: Build Codebase Index)',
    };
  }

  if (mention === 'rules') {
    const res = await fetch(`${getServiceUrl()}/rules?workspaceRoot=${encodeURIComponent(ws)}`);
    const json = (await res.json()) as { system: string };
    return { type: 'rules', label: 'Project rules', content: json.system };
  }

  if (mention.startsWith('file:')) {
    const spec = mention.slice(5);
    const lineMatch = spec.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      return attachmentFromFile({
        path: lineMatch[1]!,
        startLine: parseInt(lineMatch[2]!, 10),
        endLine: lineMatch[3] ? parseInt(lineMatch[3], 10) : parseInt(lineMatch[2]!, 10),
      });
    }
    return attachmentFromFile({ path: spec });
  }

  if (mention.startsWith('folder:')) {
    return attachmentFromFolder(mention.slice(7));
  }

  if (mention === 'symbols') {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return null;
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      ed.document.uri
    );
    const content = JSON.stringify(symbols, null, 2).slice(0, 20_000);
    return { type: 'symbols', label: 'Document symbols', content };
  }

  return null;
}

export async function pickContext(): Promise<ContextAttachment[]> {
  const items: vscode.QuickPickItem[] = [
    { label: '@file', description: 'Pick a file', detail: 'file' },
    { label: '@folder', description: 'Pick a folder', detail: 'folder' },
    { label: '@codebase', description: 'Semantic search', detail: 'codebase' },
    { label: '@selection', description: 'Current selection', detail: 'selection' },
    { label: '@open', description: 'Open tabs', detail: 'open' },
    { label: '@terminal', description: 'Terminal output', detail: 'terminal' },
    { label: '@git', description: 'Git status/diff', detail: 'git' },
    { label: '@rules', description: 'Project rules', detail: 'rules' },
    { label: '@symbols', description: 'LSP symbols', detail: 'symbols' },
  ];

  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Add context (@)' });
  if (!picked?.detail) return [];

  const attachments: ContextAttachment[] = [];

  if (picked.detail === 'file') {
    const uris = await vscode.window.showOpenDialog({ canSelectMany: true });
    for (const u of uris ?? []) {
      const rel = path.relative(getWorkspaceRoot(), u.fsPath);
      const a = await resolveMention(`file:${rel}`);
      if (a) attachments.push(a);
    }
  } else if (picked.detail === 'folder') {
    const uris = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
    for (const u of uris ?? []) {
      const rel = path.relative(getWorkspaceRoot(), u.fsPath);
      const a = await resolveMention(`folder:${rel}`);
      if (a) attachments.push(a);
    }
  } else if (picked.detail === 'codebase') {
    const q = await vscode.window.showInputBox({ prompt: 'Codebase search query' });
    if (q) {
      const a = await resolveMention('codebase', q);
      if (a) attachments.push(a);
    }
  } else {
    const a = await resolveMention(picked.detail);
    if (a) attachments.push(a);
  }

  return attachments;
}
