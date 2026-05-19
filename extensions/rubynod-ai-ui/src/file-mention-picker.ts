import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getWorkspaceRoot } from './settings';
import { searchWorkspaceSymbols } from './workspace-symbols';

export interface MentionSuggestion {
  label: string;
  path: string;
  kind: 'file' | 'folder' | 'symbol';
  description?: string;
  startLine?: number;
  endLine?: number;
  symbolName?: string;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.rubynod']);

/** Fuzzy file/folder/symbol search for @ mentions */
export async function suggestMentions(query: string, limit = 20): Promise<MentionSuggestion[]> {
  const ws = getWorkspaceRoot();
  const raw = query.replace(/^@/, '');
  if (raw.toLowerCase().startsWith('symbol:')) {
    const symQ = raw.slice(7);
    const symbols = await searchWorkspaceSymbols(symQ, limit);
    return symbols.map((s) => ({
      label: s.label,
      path: s.path,
      kind: 'symbol' as const,
      description: s.description,
      startLine: s.startLine,
      endLine: s.endLine,
      symbolName: s.name,
    }));
  }

  const q = raw.toLowerCase().replace(/^\//, '');
  const results: MentionSuggestion[] = [];

  if (q.length >= 2 && !q.includes('/')) {
    const symbols = await searchWorkspaceSymbols(q, Math.min(8, limit));
    for (const s of symbols) {
      results.push({
        label: `$(symbol-method) ${s.name} — ${s.path}`,
        path: s.path,
        kind: 'symbol',
        description: `@symbol:${s.name}`,
        startLine: s.startLine,
        endLine: s.endLine,
        symbolName: s.name,
      });
    }
  }

  const pattern = q ? `**/*${q.split('/').pop() ?? ''}*` : '**/*';
  const uris = await vscode.workspace.findFiles(
    pattern,
    '**/{node_modules,.git,dist,build}/**',
    200
  );

  for (const uri of uris) {
    const rel = path.relative(ws, uri.fsPath).replace(/\\/g, '/');
    if (SKIP.has(rel.split('/')[0] ?? '')) continue;
    const score = scoreMatch(rel, q);
    if (q && score === 0) continue;
    results.push({
      label: rel,
      path: rel,
      kind: 'file',
      description: `@${rel}`,
    });
  }

  if (q && !q.includes('.')) {
    const dirs = await findMatchingDirs(ws, q, 10);
    for (const d of dirs) {
      results.unshift({
        label: `${d}/`,
        path: d,
        kind: 'folder',
        description: `@folder:${d}`,
      });
    }
  }

  results.sort((a, b) => scoreMatch(b.path, q) - scoreMatch(a.path, q));
  return results.slice(0, limit);
}

function scoreMatch(rel: string, q: string): number {
  if (!q) return 1;
  const lower = rel.toLowerCase();
  if (lower === q) return 100;
  if (lower.endsWith(q)) return 80;
  if (lower.includes(q)) return 50;
  const parts = q.split('/');
  let score = 0;
  for (const p of parts) {
    if (p && lower.includes(p)) score += 10;
  }
  return score;
}

async function findMatchingDirs(root: string, q: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string, depth: number) => {
    if (out.length >= limit || depth > 4) return;
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      if (SKIP.has(name)) continue;
      const r = rel ? `${rel}/${name}` : name;
      if (type === vscode.FileType.Directory) {
        if (!q || r.toLowerCase().includes(q)) out.push(r);
        await walk(path.join(dir, name), r, depth + 1);
      }
    }
  };
  await walk(root, '', 0);
  return out;
}

/** Quick pick when user presses @ button or Cmd+Shift+L style attach */
export async function pickFilesAndFolders(): Promise<MentionSuggestion[]> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: true,
    openLabel: 'Add to Rubynod Chat',
  });
  if (!files?.length) return [];
  const ws = getWorkspaceRoot();
  return files.map((u) => {
    const rel = path.relative(ws, u.fsPath).replace(/\\/g, '/');
    const stat = fsStatSync(u.fsPath);
    return {
      label: stat?.isDirectory() ? `${rel}/` : rel,
      path: rel,
      kind: stat?.isDirectory() ? 'folder' : 'file',
    };
  });
}

function fsStatSync(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
