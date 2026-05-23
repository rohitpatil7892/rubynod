import * as vscode from 'vscode';
import * as path from 'node:path';
import type { ContextAttachment } from './context';
import { getMaxFileContextChars, getMaxContextAttachments } from './settings';
import { getWorkspaceRoot } from './settings';

const MAX_FULL_LINES = 500;

/** Resolve a URI string (file://, or plain path) to a workspace-relative path.
 *  Returns null if the file is outside the workspace or not a file URI. */
function resolveDroppedUri(uriString: string, wsRoot: string): string | null {
  let fsPath: string;
  try {
    if (uriString.startsWith('file://')) {
      fsPath = vscode.Uri.parse(uriString).fsPath;
    } else {
      fsPath = uriString;
    }
  } catch {
    return null;
  }
  const resolved = path.resolve(fsPath);
  const wsResolved = path.resolve(wsRoot);
  if (!resolved.startsWith(wsResolved + path.sep) && resolved !== wsResolved) {
    return null;
  }
  return resolved;
}

/** Build a ContextAttachment for a single dropped URI string. */
export async function attachmentFromDroppedUri(uriString: string): Promise<ContextAttachment | null> {
  const wsRoot = getWorkspaceRoot();
  const abs = resolveDroppedUri(uriString, wsRoot);
  if (!abs) return null;

  const rel = path.relative(wsRoot, abs).replace(/\\/g, '/');
  const name = path.basename(abs);

  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
    const raw = Buffer.from(bytes).toString('utf8');
    const maxChars = getMaxFileContextChars();
    const lines = raw.split('\n');

    if (lines.length > MAX_FULL_LINES) {
      // Large file: send first MAX_FULL_LINES lines + truncation note
      const head = lines.slice(0, MAX_FULL_LINES).join('\n');
      const truncNote = `\n... (${lines.length - MAX_FULL_LINES} more lines — use @${rel}:LINE-LINE to target a range)`;
      content = (head + truncNote).slice(0, maxChars);
    } else {
      content = raw.slice(0, maxChars);
    }
  } catch {
    return null;
  }

  return {
    type: 'file',
    label: name,
    path: rel,
    content: `## Attached file: ${rel}\n\`\`\`\n${content}\n\`\`\``,
  };
}

/** Load multiple dropped URIs respecting max-attachment cap. */
export async function loadDroppedUris(uris: string[]): Promise<ContextAttachment[]> {
  const maxAtt = getMaxContextAttachments();
  const results: ContextAttachment[] = [];
  for (const uri of uris.slice(0, maxAtt)) {
    const att = await attachmentFromDroppedUri(uri);
    if (att) results.push(att);
  }
  return results;
}
