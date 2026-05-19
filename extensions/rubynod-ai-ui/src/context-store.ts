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
}> {
  return pending.map((p) => ({
    label: p.label,
    type: p.type,
    path: p.path,
    startLine: p.startLine,
  }));
}

export function clearContext(): void {
  pending = [];
}

export function removeContext(label: string): void {
  pending = pending.filter((p) => p.label !== label);
}
