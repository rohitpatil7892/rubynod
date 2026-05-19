import * as vscode from 'vscode';
import type { AgentMode } from './api';
import { getWorkspaceRoot } from './settings';

const STORAGE_VERSION = 2;
const MAX_SESSIONS = 50;
const MAX_ENTRIES_PER_SESSION = 400;
const DEFAULT_TITLE = 'New Chat';

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

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  threadId?: string;
  entries: ChatHistoryEntry[];
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  preview: string;
  active: boolean;
}

interface SessionsStore {
  v: number;
  activeId: string;
  sessions: ChatSession[];
}

/** Legacy v1 single-thread store */
interface LegacyChatHistoryStore {
  v?: number;
  threadId?: string;
  entries?: ChatHistoryEntry[];
}

function storageKey(): string {
  const root = getWorkspaceRoot();
  return `rubynod.chatHistory.${root || '__no_workspace__'}`;
}

function newId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function titleFromText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return DEFAULT_TITLE;
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

function previewFromEntries(entries: ChatHistoryEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === 'user') return titleFromText(e.text);
    if (e.kind === 'assistant') return titleFromText(e.text);
  }
  return '';
}

function lastEntryTs(entries: ChatHistoryEntry[]): number {
  return entries.length ? entries[entries.length - 1].ts : Date.now();
}

function createSession(partial?: Partial<ChatSession>): ChatSession {
  const now = Date.now();
  return {
    id: partial?.id ?? newId(),
    title: partial?.title ?? DEFAULT_TITLE,
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
    threadId: partial?.threadId,
    entries: partial?.entries ? [...partial.entries] : [],
  };
}

function emptyStore(): SessionsStore {
  const session = createSession();
  return { v: STORAGE_VERSION, activeId: session.id, sessions: [session] };
}

export class ChatHistory {
  private cache: SessionsStore | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private migrate(raw: unknown): SessionsStore {
    if (raw && typeof raw === 'object' && 'sessions' in raw) {
      const store = raw as SessionsStore;
      const sessions = (store.sessions ?? []).map((s) => ({
        ...s,
        entries: (s.entries ?? []).slice(-MAX_ENTRIES_PER_SESSION),
      }));
      if (!sessions.length) return emptyStore();
      const activeId = sessions.some((s) => s.id === store.activeId)
        ? store.activeId
        : sessions[0].id;
      return { v: STORAGE_VERSION, activeId, sessions: sessions.slice(0, MAX_SESSIONS) };
    }

    const legacy = raw as LegacyChatHistoryStore | undefined;
    const session = createSession();
    if (legacy?.entries?.length) {
      session.entries = legacy.entries.slice(-MAX_ENTRIES_PER_SESSION);
      session.threadId = legacy.threadId;
      const firstUser = legacy.entries.find((e) => e.kind === 'user');
      session.title =
        firstUser && firstUser.kind === 'user'
          ? titleFromText(firstUser.text)
          : previewFromEntries(legacy.entries) || DEFAULT_TITLE;
      session.updatedAt = lastEntryTs(legacy.entries);
    }
    return { v: STORAGE_VERSION, activeId: session.id, sessions: [session] };
  }

  private loadStore(): SessionsStore {
    if (this.cache) return this.cache;
    const raw = this.context.workspaceState.get<unknown>(storageKey());
    this.cache = raw ? this.migrate(raw) : emptyStore();
    return this.cache;
  }

  private activeSession(): ChatSession {
    const store = this.loadStore();
    let session = store.sessions.find((s) => s.id === store.activeId);
    if (!session) {
      session = store.sessions[0] ?? createSession();
      store.activeId = session.id;
      if (!store.sessions.length) store.sessions.push(session);
    }
    return session;
  }

  listSessions(): ChatSessionSummary[] {
    const store = this.loadStore();
    return [...store.sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id,
        title: s.title || DEFAULT_TITLE,
        updatedAt: s.updatedAt,
        preview: previewFromEntries(s.entries),
        active: s.id === store.activeId,
      }));
  }

  getActiveSessionId(): string {
    return this.loadStore().activeId;
  }

  getEntries(): ChatHistoryEntry[] {
    return [...this.activeSession().entries];
  }

  getThreadId(): string | undefined {
    return this.activeSession().threadId;
  }

  setThreadId(threadId: string | undefined): void {
    const session = this.activeSession();
    session.threadId = threadId;
    void this.persist();
  }

  append(entry: ChatHistoryEntry): void {
    const session = this.activeSession();
    session.entries.push(entry);
    if (session.entries.length > MAX_ENTRIES_PER_SESSION) {
      session.entries = session.entries.slice(-MAX_ENTRIES_PER_SESSION);
    }
    session.updatedAt = entry.ts;
    if (entry.kind === 'user' && session.title === DEFAULT_TITLE) {
      session.title = titleFromText(entry.text);
    }
    void this.persist();
  }

  async newSession(): Promise<ChatSession> {
    const store = this.loadStore();
    const session = createSession();
    store.sessions.unshift(session);
    if (store.sessions.length > MAX_SESSIONS) {
      store.sessions = store.sessions.slice(0, MAX_SESSIONS);
    }
    store.activeId = session.id;
    await this.persist();
    return session;
  }

  async switchSession(id: string): Promise<ChatSession | undefined> {
    const store = this.loadStore();
    const session = store.sessions.find((s) => s.id === id);
    if (!session) return undefined;
    store.activeId = id;
    await this.persist();
    return session;
  }

  async deleteSession(id: string): Promise<string | undefined> {
    const store = this.loadStore();
    if (store.sessions.length <= 1) return store.activeId;
    const idx = store.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return store.activeId;
    store.sessions.splice(idx, 1);
    if (store.activeId === id) {
      store.activeId = store.sessions[0].id;
    }
    await this.persist();
    return store.activeId;
  }

  async clear(): Promise<void> {
    this.cache = emptyStore();
    await this.context.workspaceState.update(storageKey(), this.cache);
  }

  private async persist(): Promise<void> {
    const store = this.loadStore();
    this.cache = store;
    await this.context.workspaceState.update(storageKey(), store);
  }
}
