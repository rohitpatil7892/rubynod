import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContextAttachment } from './context';
import { getWorkspaceRoot, getMaxFileContextChars } from './settings';
import { attachmentFromFolder } from './folder-context';

export { attachmentFromFolder };

function maxFileChars(): number {
  return getMaxFileContextChars();
}

export interface FileRef {
  path: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Parse @ mentions from chat:
 *   @src/foo.ts
 *   @src/foo.ts:10-42
 *   @folder:packages/api
 *   @packages/api/   (folder by trailing slash)
 */
const RESERVED_MENTIONS = new Set([
  'codebase',
  'web',
  'symbol',
  'folder',
  'file',
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
]);

/** @mentions must look like paths (foo.ts, src/bar), not bare words like @typescript. */
function isLikelyFilePath(p: string): boolean {
  if (p.startsWith('folder:')) return true;
  if (p.includes('/') || p.includes('.')) return true;
  if (RESERVED_MENTIONS.has(p.toLowerCase())) return false;
  return false;
}

export function parseFileMentions(text: string): FileRef[] {
  const refs: FileRef[] = [];
  const seen = new Set<string>();

  const patterns = [
    /@folder:([^\s@]+)/g,
    /@([^\s@]+?)\/(?=\s|$|[,.)])/g,
    /@([^\s@]+?)(?::(\d+)(?:-(\d+))?)?(?=\s|$|[,.)])/g,
  ];

  let m: RegExpExecArray | null;

  while ((m = patterns[0]!.exec(text)) !== null) {
    const p = m[1]!.replace(/\/$/, '');
    const key = `folder:${p}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ path: `folder:${p}` });
    }
  }

  while ((m = patterns[1]!.exec(text)) !== null) {
    let p = m[1]!;
    if (p.startsWith('file:') || p === 'folder') continue;
    const key = `folder:${p}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ path: `folder:${p}` });
    }
  }

  while ((m = patterns[2]!.exec(text)) !== null) {
    let p = m[1]!;
    if (p.startsWith('file:') || p.startsWith('folder:')) continue;
    if (p.endsWith('/')) {
      const fp = p.slice(0, -1);
      const key = `folder:${fp}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ path: `folder:${fp}` });
      }
      continue;
    }
    if (!isLikelyFilePath(p)) continue;
    const start = m[2] ? parseInt(m[2], 10) : undefined;
    const end = m[3] ? parseInt(m[3], 10) : start;
    const key = `file:${p}:${start ?? ''}:${end ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ path: p, startLine: start, endLine: end });
    }
  }

  return refs;
}

function readLines(content: string, startLine?: number, endLine?: number): string {
  const lines = content.split('\n');
  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(lines.length, endLine ?? lines.length);
  return lines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}|${line}`)
    .join('\n');
}

export function formatFileBlock(ref: FileRef, content: string): string {
  const range =
    ref.startLine != null
      ? ref.endLine != null && ref.endLine !== ref.startLine
        ? `#L${ref.startLine}-L${ref.endLine}`
        : `#L${ref.startLine}`
      : '';
  const ext = path.extname(ref.path).replace('.', '') || 'text';
  return `### File: ${ref.path}${range}\n\`\`\`${ext}\n${content}\n\`\`\``;
}

export async function attachmentFromFile(ref: FileRef): Promise<ContextAttachment | null> {
  const ws = getWorkspaceRoot();
  const rel = ref.path.replace(/^\//, '').replace(/^folder:/, '');
  if (ref.path.startsWith('folder:') || ref.path.endsWith('/')) {
    return attachmentFromFolder(rel);
  }
  const abs = path.isAbsolute(rel) ? rel : path.join(ws, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;

  let raw = fs.readFileSync(abs, 'utf8');
  const limit = maxFileChars();
  if (raw.length > limit && !ref.startLine) {
    raw = raw.slice(0, limit) + '\n\n... (truncated — use @file:line-range for more)';
  }

  const sliced = readLines(raw, ref.startLine, ref.endLine);
  const label =
    ref.startLine != null
      ? `${rel}:${ref.startLine}${ref.endLine && ref.endLine !== ref.startLine ? `-${ref.endLine}` : ''}`
      : rel;

  return {
    type: 'file',
    label,
    content: formatFileBlock(ref, sliced),
    path: rel,
    startLine: ref.startLine,
    endLine: ref.endLine,
  };
}

export async function attachmentFromUri(
  uri: vscode.Uri,
  selection?: vscode.Range
): Promise<ContextAttachment | null> {
  const ws = getWorkspaceRoot();
  const rel = path.relative(ws, uri.fsPath).replace(/\\/g, '/');
  if (fs.statSync(uri.fsPath).isDirectory()) {
    return attachmentFromFolder(rel);
  }
  const ref: FileRef = { path: rel };
  if (selection && !selection.isEmpty) {
    ref.startLine = selection.start.line + 1;
    ref.endLine = selection.end.line + 1;
  }
  return attachmentFromFile(ref);
}

export async function attachmentsFromSuggestions(
  items: Array<{
    path: string;
    kind: 'file' | 'folder' | 'symbol';
    startLine?: number;
    endLine?: number;
    symbolName?: string;
  }>
): Promise<ContextAttachment[]> {
  const out: ContextAttachment[] = [];
  for (const item of items) {
    if (item.kind === 'folder') {
      const a = await attachmentFromFolder(item.path);
      if (a) out.push(a);
    } else if (item.kind === 'symbol' && item.startLine) {
      const a = await attachmentFromFile({
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine ?? item.startLine,
      });
      if (a) {
        a.type = 'symbols';
        a.label = item.symbolName ? `${item.symbolName} (${item.path})` : a.label;
        out.push(a);
      }
    } else {
      const a = await attachmentFromFile({ path: item.path });
      if (a) out.push(a);
    }
  }
  return out;
}

export async function resolveParsedMentions(text: string): Promise<ContextAttachment[]> {
  const refs = parseFileMentions(text);
  const out: ContextAttachment[] = [];
  for (const ref of refs) {
    const a = await attachmentFromFile(ref);
    if (a) out.push(a);
  }
  return out;
}

export async function getActiveEditorAttachment(): Promise<ContextAttachment | null> {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.scheme !== 'file') return null;
  return attachmentFromUri(ed.document.uri, ed.selection);
}
