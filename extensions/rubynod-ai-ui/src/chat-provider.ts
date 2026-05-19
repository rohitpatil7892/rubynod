import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  getDefaultChatMode,
  isIncludeActiveFile,
  isIncludeOpenFiles,
  getMaxContextAttachments,
  getProvider,
  getModel,
  getOllamaHost,
  getServiceUrl,
} from './settings';
import { createIdeBridge } from './bridge';
import { pickContext, type ContextAttachment } from './context';
import { streamAgent, cancelAgent, type AgentMode } from './api';
import { formatAiConnectionError, isAiServiceHealthy, startAiService } from './ai-service';
import {
  addPendingDiff,
  acceptDiff,
  rejectDiff,
  saveCheckpoint,
  getPendingDiffs,
} from './diff-manager';
import { addContext, clearContext, getPendingContext, removeContext, getChipsPayload } from './context-store';
import { attachmentFromUri, resolveParsedMentions, getActiveEditorAttachment } from './file-context';
import { getChatHtml } from './chat-ui';
import { suggestMentions } from './file-mention-picker';
import { resolveAtQuery } from './context-resolver';
import { getWorkspaceRoot } from './settings';
import { ChatHistory, type ChatHistoryEntry } from './chat-history';
import { isSimpleGreeting } from './greeting';
import {
  CHAT_PROVIDERS,
  cloudModelsForProvider,
  defaultBaseUrlForProvider,
  type ChatProviderId,
} from './model-catalog';

let toolIdCounter = 0;

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rubynod.chatView';
  private view?: vscode.WebviewView;
  private threadId?: string;
  private mode: AgentMode = getDefaultChatMode();
  private running = false;
  private activeTools = new Map<string, { name: string; args: Record<string, unknown> }>();
  private turnAssistantText = '';
  /** Multi-file edit targets (formerly Composer-only). */
  private targetFiles: string[] = [];
  private readonly history: ChatHistory;
  private healthTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.history = new ChatHistory(context);
    this.threadId = this.history.getThreadId();
  }

  addAttachments(items: ContextAttachment[]): void {
    addContext(items);
    this.refreshChips();
  }

  private refreshChips(): void {
    this.post({ type: 'chips', items: getChipsPayload() });
  }

  private refreshTargets(): void {
    this.post({ type: 'targets', files: this.targetFiles });
  }

  private refreshPendingDiffs(): void {
    this.post({ type: 'pendingDiffs', count: getPendingDiffs().length });
  }

  private postSessionState(): void {
    const entries = this.history.getEntries();
    this.threadId = this.history.getThreadId();
    this.post({
      type: 'sessions',
      sessions: this.history.listSessions(),
      activeId: this.history.getActiveSessionId(),
    });
    if (entries.length) {
      this.post({ type: 'hydrate', entries, threadId: this.threadId });
    } else {
      this.post({ type: 'clear' });
    }
  }

  private restoreHistory(): void {
    this.postSessionState();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getChatHtml(getDefaultChatMode());
    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.refreshChips();
    this.refreshTargets();
    this.refreshPendingDiffs();
    this.restoreHistory();
    void this.refreshAiStatus();
    void this.refreshChatModels();
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => void this.refreshAiStatus(), 8000);
    webviewView.onDidDispose(() => {
      if (this.healthTimer) {
        clearInterval(this.healthTimer);
        this.healthTimer = undefined;
      }
    });
  }

  private async refreshAiStatus(): Promise<void> {
    this.post({ type: 'aiStatus', online: false, checking: true });
    const online = await isAiServiceHealthy();
    this.post({ type: 'aiStatus', online, checking: false });
    if (online) void this.refreshChatModels();
  }

  private async refreshChatModels(requestedProvider?: string): Promise<void> {
    const provider = (requestedProvider || getProvider()) as ChatProviderId;
    const current = getModel();
    let models: string[] = [];
    let picked = current;

    if (provider === 'ollama') {
      const host = getOllamaHost();
      try {
        const res = await fetch(
          `${getServiceUrl()}/ollama/models?host=${encodeURIComponent(host)}`
        );
        const json = (await res.json()) as {
          models?: Array<{ name: string }>;
          suggested?: string;
        };
        models = (json.models ?? []).map((m) => m.name);
        picked = models.includes(current)
          ? current
          : (json.suggested ?? models[0] ?? current);
      } catch {
        models = current ? [current] : [];
        picked = current;
      }
    } else {
      models = cloudModelsForProvider(provider, current);
      picked = models.includes(current) ? current : (models[0] ?? current);
    }

    this.post({
      type: 'chatModels',
      provider,
      providers: CHAT_PROVIDERS,
      models,
      current: picked,
      showPicker: models.length > 0,
    });
  }

  async clearHistory(): Promise<void> {
    this.threadId = undefined;
    this.targetFiles = [];
    await this.history.clear();
    this.refreshTargets();
    this.postSessionState();
  }

  async startNewChat(): Promise<void> {
    if (this.running) return;
    this.threadId = undefined;
    this.targetFiles = [];
    this.turnAssistantText = '';
    await this.history.newSession();
    this.refreshTargets();
    this.postSessionState();
  }

  private async switchToSession(id: string): Promise<void> {
    if (this.running) return;
    const session = await this.history.switchSession(id);
    if (!session) return;
    this.threadId = session.threadId;
    this.targetFiles = [];
    this.turnAssistantText = '';
    this.refreshTargets();
    this.postSessionState();
  }

  private async removeSession(id: string): Promise<void> {
    if (this.running) return;
    const activeId = await this.history.deleteSession(id);
    if (!activeId) return;
    this.threadId = this.history.getThreadId();
    this.targetFiles = [];
    this.postSessionState();
  }

  private post(msg: unknown) {
    this.view?.webview.postMessage(msg);
  }

  private async onMessage(msg: {
    type: string;
    text?: string;
    mode?: AgentMode;
    model?: string;
    provider?: string;
    label?: string;
    path?: string;
    startLine?: number;
    query?: string;
    paths?: string[];
    file?: string;
    sessionId?: string;
  }) {
    if (msg.type === 'listSessions') {
      this.post({ type: 'sessions', sessions: this.history.listSessions(), activeId: this.history.getActiveSessionId() });
      return;
    }
    if (msg.type === 'newChat') {
      await this.startNewChat();
      return;
    }
    if (msg.type === 'selectSession' && msg.sessionId) {
      await this.switchToSession(msg.sessionId);
      return;
    }
    if (msg.type === 'deleteSession' && msg.sessionId) {
      await this.removeSession(msg.sessionId);
      return;
    }
    if (msg.type === 'startAiService') {
      void startAiService().then(() => setTimeout(() => void this.refreshAiStatus(), 2500));
      return;
    }
    if (msg.type === 'listModels') {
      void this.refreshChatModels(msg.provider);
      return;
    }
    if (msg.type === 'setModel' && msg.model) {
      const cfg = vscode.workspace.getConfiguration('rubynod');
      const provider = (msg.provider || getProvider()) as ChatProviderId;
      await cfg.update('models.provider', provider, vscode.ConfigurationTarget.Global);
      await cfg.update('models.chatModel', msg.model, vscode.ConfigurationTarget.Global);
      await cfg.update(
        'models.baseUrl',
        defaultBaseUrlForProvider(provider),
        vscode.ConfigurationTarget.Global
      );
      void this.refreshChatModels(provider);
      return;
    }
    if (msg.type === 'addContext') {
      const items = await pickContext();
      this.addAttachments(items);
      return;
    }
    if (msg.type === 'atQuery' && msg.query !== undefined) {
      const suggestions = await suggestMentions(msg.query, 15);
      this.post({ type: 'atSuggestions', suggestions });
      return;
    }
    if (msg.type === 'pickMention' && msg.query) {
      const items = await resolveAtQuery(msg.query);
      this.addAttachments(items);
      return;
    }
    if (msg.type === 'openChip' && msg.path) {
      const uri = vscode.Uri.file(path.join(getWorkspaceRoot(), msg.path));
      const opts: vscode.TextDocumentShowOptions = {};
      if (msg.startLine) {
        opts.selection = new vscode.Range(msg.startLine - 1, 0, msg.startLine - 1, 0);
      }
      await vscode.window.showTextDocument(uri, opts);
      return;
    }
    if (msg.type === 'removeChip' && msg.label) {
      removeContext(msg.label);
      this.refreshChips();
      return;
    }
    if (msg.type === 'dropFiles' && msg.paths?.length) {
      const items: ContextAttachment[] = [];
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      for (const p of msg.paths) {
        const abs = path.isAbsolute(p) ? p : path.join(ws ?? '', p);
        const a = await attachmentFromUri(vscode.Uri.file(abs));
        if (a) items.push(a);
      }
      this.addAttachments(items);
      return;
    }
    if (msg.type === 'addOpenFiles') {
      const open = vscode.window.visibleTextEditors.map((e) =>
        vscode.workspace.asRelativePath(e.document.uri)
      );
      const merged = new Set([...this.targetFiles, ...open]);
      this.targetFiles = [...merged];
      this.refreshTargets();
      return;
    }
    if (msg.type === 'removeTarget' && msg.file) {
      this.targetFiles = this.targetFiles.filter((f) => f !== msg.file);
      this.refreshTargets();
      return;
    }
    if (msg.type === 'checkpoint') {
      saveCheckpoint('chat-manual');
      vscode.window.showInformationMessage('Rubynod: checkpoint saved');
      return;
    }
    if (msg.type === 'acceptAll') {
      for (const d of getPendingDiffs()) await acceptDiff(d.file);
      this.refreshPendingDiffs();
      return;
    }
    if (msg.type === 'rejectAll') {
      for (const d of getPendingDiffs()) await rejectDiff(d.file);
      this.refreshPendingDiffs();
      return;
    }
    if (msg.type === 'acceptDiff' && msg.file) {
      await acceptDiff(msg.file);
      this.post({ type: 'diffResolved', file: msg.file });
      this.refreshPendingDiffs();
      return;
    }
    if (msg.type === 'rejectDiff' && msg.file) {
      await rejectDiff(msg.file);
      this.post({ type: 'diffResolved', file: msg.file });
      this.refreshPendingDiffs();
      return;
    }
    if (msg.type === 'stop') {
      if (this.threadId) await cancelAgent(this.threadId).catch(() => {});
      this.running = false;
      this.flushTurnToHistory();
      this.post({ type: 'runEnd' });
      return;
    }
    if (msg.type === 'send' && msg.text) {
      this.mode = msg.mode ?? 'agent';
      await this.run(msg.text, msg.model, msg.provider);
    }
  }

  private flushTurnToHistory(): void {
    const text = this.turnAssistantText.trim();
    if (text) {
      this.history.append({ kind: 'assistant', text, ts: Date.now() });
    }
    this.turnAssistantText = '';
    if (this.threadId) this.history.setThreadId(this.threadId);
  }

  private saveToolToHistory(
    id: string,
    name: string,
    args: Record<string, unknown>,
    result: string,
    ok: boolean
  ): void {
    const entry: ChatHistoryEntry = {
      kind: 'tool',
      id,
      name,
      args,
      result,
      ok,
      ts: Date.now(),
    };
    this.history.append(entry);
  }

  async run(text: string, modelOverride?: string, providerOverride?: string) {
    if (this.running) return;
    this.running = true;
    this.activeTools.clear();
    this.turnAssistantText = '';
    toolIdCounter = 0;

    this.history.append({
      kind: 'user',
      text,
      mode: this.mode,
      ts: Date.now(),
    });

    this.post({
      type: 'runStart',
      label: this.mode === 'plan' ? 'Planning' : 'Thinking',
    });

    const greeting = isSimpleGreeting(text);
    if (greeting) {
      this.threadId = undefined;
      this.history.setThreadId(undefined);
    }

    let contextItems: ContextAttachment[] = [];
    try {
      const fromMentions = greeting ? [] : await resolveParsedMentions(text);
      const pinned = greeting ? [] : getPendingContext();
      const active = !greeting && isIncludeActiveFile() ? await getActiveEditorAttachment() : null;
      let openFiles: ContextAttachment | null = null;
      if (!greeting && isIncludeOpenFiles()) {
        const bridge = createIdeBridge();
        const list = (await bridge.getOpenEditors!()) as string;
        openFiles = { type: 'open', label: 'Open tabs', content: list };
      }

      const contextMap = new Map<string, ContextAttachment>();
      const maxAtt = getMaxContextAttachments();
      for (const c of [...pinned, ...fromMentions, ...(active ? [active] : []), ...(openFiles ? [openFiles] : [])]) {
        if (contextMap.size >= maxAtt) break;
        contextMap.set(`${c.type}:${c.label}`, c);
      }
      for (const f of this.targetFiles) {
        if (contextMap.size >= maxAtt) break;
        contextMap.set(`file:${f}`, { type: 'file', label: f, content: `(edit target: ${f})` });
      }
      contextItems = [...contextMap.values()];
    } catch {
      contextItems = getPendingContext();
    }

    if (!greeting && (this.targetFiles.length > 0 || this.mode === 'agent')) {
      saveCheckpoint('pre-edit');
    }

    const composerFiles =
      !greeting && this.targetFiles.length > 0 ? [...this.targetFiles] : undefined;
    let errorMessage: string | undefined;

    try {
      for await (const event of streamAgent({
        message: text,
        mode: this.mode,
        threadId: this.threadId,
        context: contextItems,
        composerFiles,
        model: modelOverride,
        provider: providerOverride,
      })) {
        if (event.type === 'text') {
          const d = event.data as { text: string; threadId?: string };
          if (d.threadId) this.threadId = d.threadId;
          this.turnAssistantText += d.text;
          this.post({ type: 'text', text: d.text });
        }

        if (event.type === 'thinking') {
          const d = event.data as { label?: string; step?: string };
          this.post({
            type: 'activity',
            id: 'think-live',
            step: d.step ?? 'think',
            label: d.label ?? (this.mode === 'plan' ? 'Planning…' : 'Thinking…'),
            status: 'active',
          });
        }

        if (event.type === 'activity') {
          const d = event.data as {
            id: string;
            step?: string;
            label: string;
            detail?: string;
            status?: string;
          };
          this.post({
            type: 'activity',
            id: d.id,
            step: d.step ?? 'think',
            label: d.label,
            detail: d.detail,
            status: d.status ?? 'active',
          });
        }

        if (event.type === 'thought') {
          const d = event.data as { text: string };
          this.post({ type: 'thought', text: d.text });
        }

        if (event.type === 'tool_start') {
          const d = event.data as { id?: string; name: string; args: Record<string, unknown> };
          const id = d.id ?? `t-${++toolIdCounter}`;
          this.activeTools.set(id, { name: d.name, args: d.args ?? {} });
          this.post({ type: 'toolStart', id, name: d.name, args: d.args ?? {} });
        }

        if (event.type === 'tool_end') {
          const d = event.data as { id?: string; name: string; result: string };
          const id = d.id ?? [...this.activeTools.keys()].pop() ?? `t-${toolIdCounter}`;
          const tool = this.activeTools.get(id) ?? { name: d.name, args: {} };
          const ok = !d.result.startsWith('Error:') && !d.result.startsWith('Rejected');
          this.post({ type: 'toolEnd', id, name: tool.name, result: d.result, ok });
          this.saveToolToHistory(id, tool.name, tool.args, d.result, ok);
          this.activeTools.delete(id);
        }

        if (event.type === 'diff') {
          const d = event.data as { file: string; oldContent: string; newContent: string };
          this.post({ type: 'diff', file: d.file });
          void addPendingDiff(d).then(() => this.refreshPendingDiffs());
          this.turnAssistantText += `\n\n📝 Diff ready: **${d.file}** — review below\n`;
          this.post({ type: 'text', text: `\n\n📝 Diff ready: **${d.file}** — review below\n` });
        }

        if (event.type === 'plan') {
          const d = event.data as { content: string };
          this.turnAssistantText += '\n\n---\n**Plan**\n\n' + d.content;
          this.post({ type: 'text', text: '\n\n---\n**Plan**\n\n' + d.content });
        }

        if (event.type === 'done') {
          const d = event.data as { threadId: string };
          this.threadId = d.threadId;
        }

        if (event.type === 'error') {
          const d = event.data as { message: string };
          errorMessage = d.message;
          this.post({ type: 'error', message: d.message });
        }
      }
    } catch (e) {
      errorMessage = formatAiConnectionError(e);
      this.post({
        type: 'error',
        message: errorMessage,
      });
    } finally {
      this.flushTurnToHistory();
      if (errorMessage) {
        this.history.append({ kind: 'error', message: errorMessage, ts: Date.now() });
      }
      this.post({ type: 'runEnd' });
      this.running = false;
      clearContext();
      this.post({ type: 'chips', items: [] });
      this.post({
        type: 'sessions',
        sessions: this.history.listSessions(),
        activeId: this.history.getActiveSessionId(),
      });
      void this.refreshAiStatus();
    }
  }
}

let chatProviderRef: ChatViewProvider | undefined;

export function setChatProviderRef(p: ChatViewProvider): void {
  chatProviderRef = p;
}

export function getChatProviderRef(): ChatViewProvider | undefined {
  return chatProviderRef;
}
