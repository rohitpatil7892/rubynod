import * as vscode from 'vscode';
import type { ContextAttachment } from './context';

/** Shared attachments shown as chips in Chat (survives until send). */
let pending: ContextAttachment[] = [];

export function getPendingContext(): ContextAttachment[] {
  return [...pending];
}

export function addContext(items: ContextAttachment[]): void {
  for (const item of items) {
    const key = `${item.type}:${item.path ?? item.label}`;
    if (!pending.some((p) => `${p.type}:${p.path ?? p.label}` === key)) {
      pending.push(item);
    }
  }
}

export function getChipsPayload(): Array<{
  label: string;
  type: string;
  path?: string;
  startLine?: number;
  lineCount?: number;
  modifiedMs?: number;
}> {
  return pending.map((p) => {
    let lineCount: number | undefined;
    let modifiedMs: number | undefined;
    if (p.content) lineCount = p.content.split('\n').length;
    if (p.path) {
      try {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (ws) {
          const uri = vscode.Uri.file(
            p.path.startsWith('/') ? p.path : require('node:path').join(ws, p.path)
          );
          // stat is async; we fire-and-forget and just skip if unavailable
          void vscode.workspace.fs.stat(uri).then((s) => { modifiedMs = s.mtime; }, () => {});
        }
      } catch { /* skip */ }
    }
    return { label: p.label, type: p.type, path: p.path, startLine: p.startLine, lineCount, modifiedMs };
  });
}

export function clearContext(): void {
  pending = [];
}

export function removeContext(label: string): void {
  pending = pending.filter((p) => p.label !== label);
}
