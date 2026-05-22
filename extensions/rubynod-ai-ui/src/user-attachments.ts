import * as path from 'node:path';
import type { ContextAttachment } from './context';

export type UserAttachmentKind =
  | 'tab'
  | 'file'
  | 'folder'
  | 'mention'
  | 'open'
  | 'selection'
  | 'terminal'
  | 'git'
  | 'codebase'
  | 'context';

export interface UserAttachmentDisplay {
  kind: UserAttachmentKind;
  label: string;
  path?: string;
}

function basenameDisplay(p: string, startLine?: number, endLine?: number): string {
  const base = path.basename(p.replace(/\\/g, '/'));
  if (startLine != null) {
    const range =
      endLine != null && endLine !== startLine ? `${startLine}-${endLine}` : `${startLine}`;
    return `${base}:${range}`;
  }
  return base;
}

function mapContextKind(type: string): UserAttachmentKind {
  if (type === 'file') return 'file';
  if (type === 'folder') return 'folder';
  if (type === 'open') return 'open';
  if (type === 'selection') return 'selection';
  if (type === 'terminal') return 'terminal';
  if (type === 'git') return 'git';
  if (type === 'codebase') return 'codebase';
  return 'context';
}

/** Build attachment chips shown under a sent user message. */
export function buildUserAttachments(
  contextItems: ContextAttachment[],
  targetFiles: string[]
): UserAttachmentDisplay[] {
  const seen = new Set<string>();
  const out: UserAttachmentDisplay[] = [];

  const add = (item: UserAttachmentDisplay) => {
    const key = item.path ? `path:${item.path}:${item.label}` : `${item.kind}:${item.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  for (const f of targetFiles) {
    const rel = f.replace(/\\/g, '/');
    add({ kind: 'tab', label: basenameDisplay(rel), path: rel });
  }

  const tabPaths = new Set(targetFiles.map((f) => f.replace(/\\/g, '/')));

  for (const c of contextItems) {
    const rel = c.path?.replace(/\\/g, '/');
    if (rel && tabPaths.has(rel)) continue;

    const kind = mapContextKind(c.type);
    const label = rel ? basenameDisplay(rel, c.startLine, c.endLine) : c.label;
    add({ kind, label, path: rel });
  }

  return out;
}
