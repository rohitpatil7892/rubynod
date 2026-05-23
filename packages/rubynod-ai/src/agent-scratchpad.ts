/**
 * Per-thread agent scratchpad: tracks files read/edited, commands run, and errors
 * observed during the current session so the LLM can avoid re-reading or re-installing
 * things it already handled.
 */

export interface Scratchpad {
  filesRead: Set<string>;
  filesEdited: Set<string>;
  commandsRun: string[];
  errorsObserved: string[];
}

const store = new Map<string, Scratchpad>();

function get(threadId: string): Scratchpad {
  if (!store.has(threadId)) {
    store.set(threadId, {
      filesRead: new Set(),
      filesEdited: new Set(),
      commandsRun: [],
      errorsObserved: [],
    });
  }
  return store.get(threadId)!;
}

export function recordFileRead(threadId: string, path: string): void {
  get(threadId).filesRead.add(path);
}

export function recordFileEdit(threadId: string, path: string): void {
  get(threadId).filesEdited.add(path);
}

export function recordCommand(threadId: string, command: string): void {
  const pad = get(threadId);
  const cap = command.slice(0, 120);
  if (!pad.commandsRun.includes(cap)) pad.commandsRun.push(cap);
  if (pad.commandsRun.length > 20) pad.commandsRun.shift();
}

export function recordError(threadId: string, error: string): void {
  const pad = get(threadId);
  const cap = error.slice(0, 200);
  if (!pad.errorsObserved.includes(cap)) pad.errorsObserved.push(cap);
  if (pad.errorsObserved.length > 10) pad.errorsObserved.shift();
}

export function clearScratchpad(threadId: string): void {
  store.delete(threadId);
}

/** Returns a compact summary to inject into the system prompt each turn. */
export function buildScratchpadSummary(threadId: string): string {
  if (!store.has(threadId)) return '';
  const pad = get(threadId);
  const lines: string[] = [];

  if (pad.filesRead.size) {
    lines.push(`Files already read: ${[...pad.filesRead].join(', ')}`);
  }
  if (pad.filesEdited.size) {
    lines.push(`Files edited this session: ${[...pad.filesEdited].join(', ')}`);
  }
  if (pad.commandsRun.length) {
    lines.push(`Commands run: ${pad.commandsRun.map((c) => `\`${c}\``).join('; ')}`);
  }
  if (pad.errorsObserved.length) {
    lines.push(`Errors observed: ${pad.errorsObserved.map((e) => `"${e}"`).join('; ')}`);
  }

  if (!lines.length) return '';
  return `## Session context (avoid repeating these)\n${lines.join('\n')}`;
}
