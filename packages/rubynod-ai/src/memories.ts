import fs from 'node:fs';
import path from 'node:path';

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: string;
}

function memoriesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.rubynod', 'memories.json');
}

export function loadMemories(workspaceRoot: string): MemoryEntry[] {
  const p = memoriesPath(workspaceRoot);
  try {
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { memories?: MemoryEntry[] };
    return Array.isArray(raw.memories) ? raw.memories : [];
  } catch {
    return [];
  }
}

export function formatMemoriesForPrompt(workspaceRoot: string, maxEntries = 20): string {
  const list = loadMemories(workspaceRoot).slice(-maxEntries);
  if (!list.length) return '';
  const lines = list.map((m) => `- ${m.text}`);
  return `\n# User memories (Rubynod)\n${lines.join('\n')}\n`;
}

export function appendMemory(workspaceRoot: string, text: string): MemoryEntry {
  const p = memoriesPath(workspaceRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const memories = loadMemories(workspaceRoot);
  const entry: MemoryEntry = {
    id: `mem_${Date.now()}`,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  memories.push(entry);
  fs.writeFileSync(p, JSON.stringify({ memories }, null, 2), 'utf8');
  return entry;
}
