import * as path from 'node:path';
import * as vscode from 'vscode';
import { getWorkspaceRootForUri } from './settings';

export interface SymbolSuggestion {
  label: string;
  path: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  description?: string;
}

/** Workspace symbol search for @symbol: mentions (Cursor-style) */
export async function searchWorkspaceSymbols(
  query: string,
  limit = 15
): Promise<SymbolSuggestion[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  try {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      q
    );
    if (!symbols?.length) return [];

    const ws = getWorkspaceRootForUri();
    const out: SymbolSuggestion[] = [];

    for (const s of symbols) {
      if (s.location.uri.scheme !== 'file') continue;
      const rel = vscode.workspace.asRelativePath(s.location.uri);
      if (rel.startsWith('..')) continue;
      const name = s.name;
      if (!name.toLowerCase().includes(q) && !rel.toLowerCase().includes(q)) continue;
      out.push({
        label: `${name} — ${rel}`,
        path: rel,
        name,
        kind: vscode.SymbolKind[s.kind] ?? 'symbol',
        startLine: s.location.range.start.line + 1,
        endLine: s.location.range.end.line + 1,
        description: `@symbol:${name}`,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function attachmentFromSymbol(sym: SymbolSuggestion): Promise<{
  type: 'symbols';
  label: string;
  content: string;
  path: string;
  startLine: number;
  endLine: number;
} | null> {
  const uri = vscode.Uri.file(path.join(getWorkspaceRootForUri(), sym.path));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const start = Math.max(0, sym.startLine - 1);
    const end = Math.min(doc.lineCount, sym.endLine);
    const lines = doc.getText(
      new vscode.Range(start, 0, end, doc.lineAt(Math.min(end, doc.lineCount - 1)).text.length)
    );
    return {
      type: 'symbols',
      label: `${sym.name} (${sym.path}:${sym.startLine})`,
      content: lines,
      path: sym.path,
      startLine: sym.startLine,
      endLine: sym.endLine,
    };
  } catch {
    return null;
  }
}
