import * as vscode from 'vscode';
import type { ContextAttachment } from './context';
import { attachmentFromFile, attachmentFromFolder, attachmentsFromSuggestions } from './file-context';
import { suggestMentions } from './file-mention-picker';
import { resolveMention } from './context';
import { attachmentFromSymbol, searchWorkspaceSymbols } from './workspace-symbols';

export async function resolveAtQuery(query: string): Promise<ContextAttachment[]> {
  const q = query.trim();
  if (!q) return [];

  if (q.toLowerCase().startsWith('symbol:')) {
    const name = q.slice(7).trim();
    const hits = await searchWorkspaceSymbols(name, 1);
    if (hits[0]) {
      const a = await attachmentFromSymbol(hits[0]);
      return a ? [a] : [];
    }
    return [];
  }

  if (q.startsWith('folder:') || q.endsWith('/')) {
    const folder = q.replace(/^folder:/, '').replace(/\/$/, '');
    const a = await attachmentFromFolder(folder);
    return a ? [a] : [];
  }

  const lineMatch = q.match(/^(.+):(\d+)(?:-(\d+))?$/);
  if (lineMatch) {
    const a = await attachmentFromFile({
      path: lineMatch[1]!,
      startLine: parseInt(lineMatch[2]!, 10),
      endLine: lineMatch[3] ? parseInt(lineMatch[3], 10) : parseInt(lineMatch[2]!, 10),
    });
    return a ? [a] : [];
  }

  const suggestions = await suggestMentions(q, 1);
  if (suggestions.length === 1) {
    return attachmentsFromSuggestions([suggestions[0]!]);
  }

  const a = await attachmentFromFile({ path: q });
  return a ? [a] : [];
}

export { suggestMentions, resolveMention };
