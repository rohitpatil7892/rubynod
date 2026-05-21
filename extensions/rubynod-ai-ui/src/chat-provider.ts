import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  getDefaultChatMode,
  isIncludeActiveFile,
  isIncludeOpenFiles,
  getMaxContextAttachments,
  getProvider,
  getModel,
  getServiceUrl,
  getOllamaHost,
} from './settings';
import { createIdeBridge } from './bridge';
import { pickContext, type ContextAttachment } from './context';
import { streamAgent, cancelAgent, type AgentMode } from './api';
import { formatAiConnectionError, isAiServiceHealthy, startAiService } from './ai-service';
import { ensureRubynodReady } from './rubynod-ready';
import {
  addPendingDiff,
  acceptDiff,
  rejectDiff,
  saveCheckpoint,
  getPendingDiffs,
} from './diff-manager';
import { addContext, clearContext, getPendingContext, removeContext, getChipsPayload } from './context-store';
import { attachmentFromUri, resolveParsedMentions, getActiveEditorAttachment } from './file-context';
import { getChatHtml, type ChatWebviewConfig } from './chat-ui';
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
import { listOllamaModelsForChat } from './ollama-models';

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
  private bootstrapFallbackTimer?: ReturnType<typeof setTimeout>;
  private messageDisposable?: vscode.Disposable;
  private webviewReady = false;
  private panelBootstrapped = false;
  private readonly aiStatusBar: vscode.StatusBarItem;

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.history = new ChatHistory(context);
    this.threadId = this.history.getThreadId();
    this.aiStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.aiStatusBar.command = 'rubynod.startAiService';
    this.aiStatusBar.text = '$(sync~spin) Rubynod AI';
    this.aiStatusBar.tooltip = 'Rubynod AI — starting…';
    this.aiStatusBar.show();
    context.subscriptions.push(this.aiStatusBar);
  }

  private webviewConfig(): ChatWebviewConfig {
    return {
      serviceUrl: getServiceUrl(),
      ollamaHost: getOllamaHost(),
      providers: CHAT_PROVIDERS,
    };
  }

  private get extensionVersion(): string {
    return (this.context.extension.packageJSON.version as string) || '?';
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
    void this.setupWebview(webviewView);
  }

  private async setupWebview(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    this.webviewReady = false;
    this.panelBootstrapped = false;
    if (this.bootstrapFallbackTimer) {
      clearTimeout(this.bootstrapFallbackTimer);
      this.bootstrapFallbackTimer = undefined;
    }
    this.messageDisposable?.dispose();

    void ensureRubynodReady()
      .then((ready) => {
        if (!ready) {
          this.aiStatusBar.text = '$(error) Rubynod AI';
          this.aiStatusBar.tooltip =
            'AI service failed to start — Output → Rubynod AI Service, or Rubynod: Start AI Service';
        }
        return this.refreshPanel();
      })
      .catch((err) => {
        console.error('[rubynod-ai-ui] ensureRubynodReady in setupWebview:', err);
      });

    const webview = webviewView.webview;
    webview.options = { enableScripts: true };

    this.messageDisposable = webview.onDidReceiveMessage((msg) => {
      void this.handleMessage(msg).catch((err) => {
        console.error('[rubynod-ai-ui] chat webview message failed:', err);
      });
    });

    webview.html = getChatHtml(
      getDefaultChatMode(),
      this.extensionVersion,
      this.webviewConfig()
    );

    this.bootstrapFallbackTimer = setTimeout(() => {
      if (!this.webviewReady) void this.onWebviewReady();
    }, 2500);

    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      if (this.view?.webview) void this.refreshPanel();
    }, 8000);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.refreshPanel();
    });

    webviewView.onDidDispose(() => {
      this.webviewReady = false;
      this.panelBootstrapped = false;
      this.messageDisposable?.dispose();
      this.messageDisposable = undefined;
      if (this.healthTimer) {
        clearInterval(this.healthTimer);
        this.healthTimer = undefined;
      }
      if (this.bootstrapFallbackTimer) {
        clearTimeout(this.bootstrapFallbackTimer);
        this.bootstrapFallbackTimer = undefined;
      }
    });

    if (webviewView.visible) {
      setTimeout(() => void this.refreshPanel(), 500);
    }
  }

  /** Refresh status + models (safe to call anytime the chat panel is open). */
  async refreshPanel(): Promise<void> {
    if (!this.view?.webview) return;
    if (!this.webviewReady) {
      await this.onWebviewReady();
      return;
    }
    await this.refreshAiStatus();
  }

  private async onWebviewReady(): Promise<void> {
    this.webviewReady = true;
    if (this.bootstrapFallbackTimer) {
      clearTimeout(this.bootstrapFallbackTimer);
      this.bootstrapFallbackTimer = undefined;
    }
    // Push status/models immediately so UI works even if webview fetch is blocked.
    await this.refreshAiStatus();
    if (await isAiServiceHealthy()) {
      await this.refreshChatModels();
    }
    if (!this.panelBootstrapped) {
      this.panelBootstrapped = true;
      this.refreshChips();
      this.refreshTargets();
      this.refreshPendingDiffs();
      this.restoreHistory();
      await this.bootstrapChatPanel();
      return;
    }
    await this.refreshAiStatus();
    await this.refreshChatModels();
  }

  /** Start AI (if needed) and refresh Online/Offline badge in chat. */
  async bootstrapChatPanel(): Promise<void> {
    await this.refreshAiStatus();
    const ready = await ensureRubynodReady();
    await this.refreshAiStatus();
    if (ready) await this.refreshChatModels();
  }

  async refreshAiStatus(): Promise<void> {
    this.post({ type: 'aiStatus', online: false, checking: true });
    this.aiStatusBar.text = '$(sync~spin) Rubynod AI';
    const online = await isAiServiceHealthy();
    this.post({ type: 'aiStatus', online, checking: false });
    this.aiStatusBar.text = online ? '$(pass) Rubynod AI' : '$(error) Rubynod AI';
    this.aiStatusBar.tooltip = online
      ? `Rubynod AI online — ${getServiceUrl()}`
      : `Rubynod AI offline — ${getServiceUrl()} (click to start)`;
    if (online) await this.refreshChatModels();
  }

  async refreshChatModels(requestedProvider?: string): Promise<void> {
    const provider = (requestedProvider || getProvider()) as ChatProviderId;
    const current = getModel();
    let models: string[] = [];
    let picked = current;
    let error: string | undefined;

    if (!(await isAiServiceHealthy())) {
      await ensureRubynodReady();
    }

    if (provider === 'ollama') {
      const ollama = await listOllamaModelsForChat();
      models = ollama.models;
      error = ollama.error;
      picked = models.includes(current)
        ? current
        : (ollama.suggested ?? models[0] ?? current);
      if (picked && models.length && !models.includes(picked)) {
        models = [picked, ...models];
      }
    } else {
      models = cloudModelsForProvider(provider, current);
      picked = models.includes(current) ? current : (models[0] ?? current);
    }

    if (picked && models.length) {
      const cfg = vscode.workspace.getConfiguration('rubynod');
      if (picked !== current) {
        await cfg.update('models.chatModel', picked, vscode.ConfigurationTarget.Global);
      }
      await cfg.update('models.provider', provider, vscode.ConfigurationTarget.Global);
    }

    this.post({
      type: 'chatModels',
      provider,
      providers: CHAT_PROVIDERS,
      models,
      current: picked,
      showPicker: true,
      error,
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
    const webview = this.view?.webview;
    if (!webview) return;
    void webview.postMessage(msg).then(undefined, (err) => {
      console.error('[rubynod-ai-ui] webview postMessage failed:', err);
    });
  }

  private async handleMessage(msg: {
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
    if (msg.type === 'webviewReady') {
      await this.onWebviewReady();
      return;
    }
    if (msg.type === 'ping' || msg.type === 'requestAiStatus') {
      if (!this.webviewReady) {
        await this.onWebviewReady();
      } else {
        await this.refreshPanel();
      }
      return;
    }
    if (msg.type === 'startAiService') {
      void startAiService(this.context.extensionPath).then(() => void this.bootstrapChatPanel());
      return;
    }
    if (msg.type === 'listModels') {
      await this.refreshChatModels(msg.provider);
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
      try {
        const suggestions = await suggestMentions(msg.query, 15);
        this.post({ type: 'atSuggestions', suggestions });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.post({ type: 'atSuggestions', suggestions: [], error: message });
      }
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

    if (!(await ensureRubynodReady())) {
      this.post({
        type: 'error',
        message:
          'Rubynod AI is offline. Run Ollama for local models, or Cmd+Shift+P → Rubynod: Start AI Service.',
      });
      return;
    }

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
