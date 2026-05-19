import * as vscode from 'vscode';
import type { AgentMode } from './api';
import { getWorkspaceRoot } from './settings';

const STORAGE_VERSION = 1;
const MAX_ENTRIES = 400;

export type ChatHistoryEntry =
  | { kind: 'user'; text: string; mode: AgentMode; ts: number }
  | { kind: 'assistant'; text: string; ts: number }
  | {
      kind: 'tool';
      id: string;
      name: string;
      args: Record<string, unknown>;
      result: string;
      ok: boolean;
      ts: number;
    }
  | { kind: 'error'; message: string; ts: number };

export interface ChatHistoryStore {
  v: number;
  threadId?: string;
  entries: ChatHistoryEntry[];
}

function storageKey(): string {
  const root = getWorkspaceRoot();
  return `rubynod.chatHistory.${root || '__no_workspace__'}`;
}

function emptyStore(): ChatHistoryStore {
  return { v: STORAGE_VERSION, entries: [] };
}

export class ChatHistory {
  private cache: ChatHistoryStore | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  load(): ChatHistoryStore {
    if (this.cache) return this.cache;
    const raw = this.context.workspaceState.get<ChatHistoryStore>(storageKey());
    if (!raw?.entries?.length) {
      this.cache = emptyStore();
      return this.cache;
    }
    this.cache = {
      v: STORAGE_VERSION,
      threadId: raw.threadId,
      entries: raw.entries.slice(-MAX_ENTRIES),
    };
    return this.cache;
  }

  getThreadId(): string | undefined {
    return this.load().threadId;
  }

  setThreadId(threadId: string | undefined): void {
    const store = this.load();
    store.threadId = threadId;
    void this.persist(store);
  }

  getEntries(): ChatHistoryEntry[] {
    return [...this.load().entries];
  }

  append(entry: ChatHistoryEntry): void {
    const store = this.load();
    store.entries.push(entry);
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(-MAX_ENTRIES);
    }
    void this.persist(store);
  }

  async clear(): Promise<void> {
    this.cache = emptyStore();
    await this.context.workspaceState.update(storageKey(), this.cache);
  }

  private async persist(store: ChatHistoryStore): Promise<void> {
    this.cache = store;
    await this.context.workspaceState.update(storageKey(), store);
  }
}
