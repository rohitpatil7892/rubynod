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
  isShowAiOfflineIndicator,
  isShowAiStatusBarIndicator,
  isShowExtensionVersion,
  isShowThinkingInChat,
} from './settings';
import { createIdeBridge } from './bridge';
import { pickContext, type ContextAttachment } from './context';
import { streamAgent, cancelAgent, type AgentMode } from './api';
import { formatAiConnectionError, isAiServiceHealthy, startAiService } from './ai-service';
import { ensureRubynodReady } from './rubynod-ready';
import { chatLog, webviewLog } from './logger';
import {
  addPendingDiff,
  acceptDiff,
  rejectDiff,
  saveCheckpoint,
  getPendingDiffs,
} from './diff-manager';
import { addContext, clearContext, getPendingContext, removeContext, getChipsPayload } from './context-store';
import { buildUserAttachments } from './user-attachments';
import { attachmentFromUri, resolveParsedMentions, getActiveEditorAttachment } from './file-context';
import { getChatHtml, type ChatWebviewConfig } from './chat-ui';
import { suggestMentions } from './file-mention-picker';
import { resolveAtQuery } from './context-resolver';
import { getWorkspaceRoot } from './settings';
import { ChatHistory, type ChatHistoryEntry } from './chat-history';
import { isSimpleGreeting } from './greeting';
import {
  CHAT_PROVIDERS,
  defaultBaseUrlForProvider,
  type ChatProviderId,
} from './model-catalog';
import { resolveChatModelsForProvider } from './panel-models';

let toolIdCounter = 0;

/** Hide leaked tool syntax (JSON, python_tag, bare write_file) before server strips it. */
function mightBeLeakedToolText(text: string): boolean {
  if (/(?:^|\n)#{2,3}\s+Step\s+\d+/m.test(text)) return true;
  if (/(?:^|\n)Let's start by /im.test(text)) return true;
  if (/(?:^|\n)To add a new shared service/im.test(text)) return true;
  if (/(?:^|\n)We'll create a new file/im.test(text)) return true;
  if (/<\|python_tag\|>/i.test(text)) return true;
  if (/\bwrite_file\s*\(\s*contents\s*=/i.test(text)) return true;
  if (/^\s*\{\s*"(?:import|export|const|let|require)\s/m.test(text)) return true;
  if (/## Context: file —/i.test(text)) return true;
  if (/^json\s*$/i.test(text.trim())) return true;
  if (/```json/i.test(text) && /\{\s*"name/i.test(text)) return true;
  if (/^\s*\{\s*"name/i.test(text.trim())) return true;
  if (/"dependencies"\s*:\s*\{/.test(text) && /"name"\s*:\s*"/.test(text)) return true;
  const t = text.trimStart();
  if (!t.startsWith('{')) return false;
  if (
    /"name"\s*:\s*"(?:write_file|read_file|search_replace|run_terminal|glob|grep)"/.test(t)
  ) {
    return true;
  }
  return /^\{\s*"name"\s*:\s*"?/.test(t);
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rubynod.chatView';
  private view?: vscode.WebviewView;
  private threadId?: string;
  private mode: AgentMode = getDefaultChatMode();
  private running = false;
  private activeTools = new Map<string, { name: string; args: Record<string, unknown> }>();
  private turnAssistantText = '';
  private inlineToolJsonBuffer = '';
  /** Multi-file edit targets (formerly Composer-only). */
  private targetFiles: string[] = [];
  private readonly history: ChatHistory;
  private healthTimer?: ReturnType<typeof setInterval>;
  private bootstrapFallbackTimer?: ReturnType<typeof setTimeout>;
  private messageDisposable?: vscode.Disposable;
  private webviewReady = false;
  private panelBootstrapped = false;
  private modelsRefreshChain: Promise<void> = Promise.resolve();
  private readonly pendingMessages: unknown[] = [];
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
    if (isShowAiStatusBarIndicator()) this.aiStatusBar.show();
    context.subscriptions.push(this.aiStatusBar);
  }

  private webviewConfig(): ChatWebviewConfig {
    return {
      serviceUrl: getServiceUrl(),
      ollamaHost: getOllamaHost(),
      providers: CHAT_PROVIDERS,
      showAiOfflineIndicator: isShowAiOfflineIndicator(),
      showExtensionVersion: isShowExtensionVersion(),
      showThinkingInChat: isShowThinkingInChat(),
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
    this.pendingMessages.length = 0;
    if (this.bootstrapFallbackTimer) {
      clearTimeout(this.bootstrapFallbackTimer);
      this.bootstrapFallbackTimer = undefined;
    }
    this.messageDisposable?.dispose();

    const webview = webviewView.webview;
    webview.options = { enableScripts: true };

    this.messageDisposable = webview.onDidReceiveMessage((msg) => {
      void this.handleMessage(msg).catch((err) => {
        chatLog.error(`webview message failed (type=${msg?.type})`, err);
      });
    });

    const baked = await this.buildInitialPanelState();
    if (!baked.online && isShowAiStatusBarIndicator()) {
      this.aiStatusBar.show();
      this.aiStatusBar.text = '$(error) Rubynod AI';
      this.aiStatusBar.tooltip =
        baked.error ??
        'AI service failed to start — Output → Rubynod AI Service, or Rubynod: Start AI Service';
    }

    webview.html = getChatHtml(getDefaultChatMode(), this.extensionVersion, {
      ...this.webviewConfig(),
      initialOnline: baked.online,
      initialModels: baked.models,
      initialModelLabels: baked.modelLabels,
      initialCurrent: baked.current,
      initialProvider: baked.provider,
      initialError: baked.error,
    });

    this.bootstrapFallbackTimer = setTimeout(() => {
      if (!this.webviewReady) {
        chatLog.warn('webviewReady not received — running fallback bootstrap');
        void this.onWebviewReady();
      }
    }, 4000);

    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      if (this.view?.webview) void this.refreshPanel();
    }, 8000);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.webviewReady) void this.refreshPanel();
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
      setTimeout(() => {
        if (this.webviewReady) void this.refreshPanel();
      }, 500);
    }
  }

  /** Refresh status + models (safe to call anytime the chat panel is open). */
  async refreshPanel(): Promise<void> {
    await this.pushPanelInit();
  }

  /** Sync AI status and model list to the webview (extension-side; no webview fetch). */
  async pushPanelInit(): Promise<void> {
    if (!this.view?.webview || !this.webviewReady) return;
    try {
      await this.refreshAiStatus();
      await this.refreshChatModels();
    } catch (err) {
      chatLog.error('pushPanelInit failed', err);
      this.post({
        type: 'chatModels',
        loading: false,
        provider: getProvider(),
        providers: CHAT_PROVIDERS,
        models: [],
        current: getModel(),
        showPicker: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Force-reload chat webview HTML (fixes a stuck panel). */
  async reloadWebviewView(): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand('rubynod.chatView.focus');
      return;
    }
    this.webviewReady = false;
    this.panelBootstrapped = false;
    this.pendingMessages.length = 0;
    if (this.bootstrapFallbackTimer) {
      clearTimeout(this.bootstrapFallbackTimer);
      this.bootstrapFallbackTimer = undefined;
    }
    const baked = await this.buildInitialPanelState();
    this.view.webview.html = getChatHtml(getDefaultChatMode(), this.extensionVersion, {
      ...this.webviewConfig(),
      initialOnline: baked.online,
      initialModels: baked.models,
      initialModelLabels: baked.modelLabels,
      initialCurrent: baked.current,
      initialProvider: baked.provider,
      initialError: baked.error,
    });
    this.bootstrapFallbackTimer = setTimeout(() => {
      if (!this.webviewReady) void this.onWebviewReady();
    }, 4000);
  }

  private postLoadingModels(provider?: ChatProviderId): void {
    this.post({
      type: 'chatModels',
      loading: true,
      provider: provider ?? getProvider(),
      providers: CHAT_PROVIDERS,
      models: [],
      current: getModel(),
      showPicker: true,
    });
  }

  private async buildInitialPanelState(): Promise<{
    online: boolean;
    provider: string;
    models: string[];
    modelLabels?: Record<string, string>;
    current: string;
    error?: string;
  }> {
    let online = await isAiServiceHealthy();
    if (!online) {
      const ready = await Promise.race([
        ensureRubynodReady(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 12_000)),
      ]);
      online = ready && (await isAiServiceHealthy());
    }
    if (!online) {
      return {
        online: false,
        provider: getProvider(),
        models: [],
        current: getModel(),
        error: `Rubynod AI not reachable at ${getServiceUrl()}. Ollama alone is not enough — run Command Palette → Rubynod: Start AI Service.`,
      };
    }
    try {
      const resolved = await resolveChatModelsForProvider(undefined, 12_000);
      return {
        online: true,
        provider: resolved.provider,
        models: resolved.models,
        modelLabels: resolved.modelLabels,
        current: resolved.current,
        error: resolved.error,
      };
    } catch (err) {
      chatLog.error('buildInitialPanelState failed', err);
      return {
        online: true,
        provider: getProvider(),
        models: [],
        current: getModel(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async onWebviewReady(): Promise<void> {
    this.webviewReady = true;
    if (this.bootstrapFallbackTimer) {
      clearTimeout(this.bootstrapFallbackTimer);
      this.bootstrapFallbackTimer = undefined;
    }

    this.flushPendingMessages();

    if (!this.panelBootstrapped) {
      this.panelBootstrapped = true;
      this.refreshChips();
      this.refreshTargets();
      this.refreshPendingDiffs();
      this.restoreHistory();
    }

    void this.pushPanelInit().catch((err) => chatLog.error('pushPanelInit after ready failed', err));
  }

  /** Start AI (if needed) and refresh chat panel. */
  async bootstrapChatPanel(): Promise<void> {
    await ensureRubynodReady();
    await this.pushPanelInit();
  }

  async refreshAiStatus(): Promise<void> {
    this.post({ type: 'aiStatus', online: false, checking: true, hidden: !isShowAiOfflineIndicator() });
    if (isShowAiStatusBarIndicator()) {
      this.aiStatusBar.show();
      this.aiStatusBar.text = '$(sync~spin) Rubynod AI';
    } else {
      this.aiStatusBar.hide();
    }
    const online = await isAiServiceHealthy();
    this.post({ type: 'aiStatus', online, checking: false, hidden: !isShowAiOfflineIndicator() });
    if (isShowAiStatusBarIndicator()) {
      this.aiStatusBar.show();
      this.aiStatusBar.text = online ? '$(pass) Rubynod AI' : '$(error) Rubynod AI';
      this.aiStatusBar.tooltip = online
        ? `Rubynod AI online — ${getServiceUrl()}`
        : `Rubynod AI offline — ${getServiceUrl()} (click to start)`;
    } else {
      this.aiStatusBar.hide();
    }
  }

  async refreshChatModels(requestedProvider?: string): Promise<void> {
    if (!this.view?.webview) return;
    this.modelsRefreshChain = this.modelsRefreshChain
      .then(() => this.doRefreshChatModels(requestedProvider))
      .catch((err) => {
        chatLog.error('refreshChatModels failed', err);
      });
    return this.modelsRefreshChain;
  }

  private async doRefreshChatModels(requestedProvider?: string): Promise<void> {
    const provider = (requestedProvider || getProvider()) as ChatProviderId;
    const current = getModel();

    this.postLoadingModels(provider);

    if (!(await isAiServiceHealthy())) {
      const ready = await Promise.race([
        ensureRubynodReady(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20_000)),
      ]);
      if (!ready && !(await isAiServiceHealthy())) {
        this.post({
          type: 'chatModels',
          loading: false,
          provider,
          providers: CHAT_PROVIDERS,
          models: [],
          current: current,
          showPicker: true,
          error:
            'Rubynod AI service did not start. Output → Rubynod AI Service, or Command Palette → Rubynod: Start AI Service.',
        });
        this.post({
          type: 'aiStatus',
          online: false,
          checking: false,
          hidden: !isShowAiOfflineIndicator(),
        });
        return;
      }
    }

    const resolved = await resolveChatModelsForProvider(provider);
    const { models, modelLabels, current: picked, error } = resolved;

    if (picked && models.length) {
      const cfg = vscode.workspace.getConfiguration('rubynod');
      if (picked !== current) {
        await cfg.update('models.chatModel', picked, vscode.ConfigurationTarget.Global);
      }
      await cfg.update('models.provider', provider, vscode.ConfigurationTarget.Global);
    }

    this.post({
      type: 'chatModels',
      loading: false,
      provider,
      providers: CHAT_PROVIDERS,
      models,
      modelLabels,
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

  private flushPendingMessages(): void {
    const webview = this.view?.webview;
    if (!webview || !this.pendingMessages.length) return;
    const batch = [...this.pendingMessages];
    this.pendingMessages.length = 0;
    for (const msg of batch) {
      void webview.postMessage(msg).then(undefined, (err) => {
        chatLog.error('webview postMessage failed (queued)', err);
      });
    }
  }

  private post(msg: unknown) {
    const webview = this.view?.webview;
    if (!webview) return;
    if (!this.webviewReady) {
      this.pendingMessages.push(msg);
      return;
    }
    void webview.postMessage(msg).then(undefined, (err) => {
      chatLog.error('webview postMessage failed', err);
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
    chatLog.debug('webview → extension', { type: msg.type });
    if (msg.type === 'log' && msg.text) {
      webviewLog.debug(String(msg.text));
      return;
    }
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
    if (msg.type === 'openSettings') {
      await vscode.commands.executeCommand('rubynod.openSettings');
      return;
    }
    if (msg.type === 'webviewReady') {
      await this.onWebviewReady();
      return;
    }
    if (msg.type === 'ping' || msg.type === 'requestAiStatus' || msg.type === 'requestInit') {
      if (!this.webviewReady) await this.onWebviewReady();
      else await this.pushPanelInit();
      return;
    }
    if (msg.type === 'reloadWebview') {
      await this.reloadWebviewView();
      return;
    }
    if (msg.type === 'startAiService') {
      void startAiService(this.context.extensionPath).then(() => void this.pushPanelInit());
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
      chatLog.error('Chat run aborted: Rubynod AI offline');
      this.post({
        type: 'error',
        message:
          'Rubynod AI is offline. Run Ollama for local models, or Cmd+Shift+P → Rubynod: Start AI Service.',
      });
      return;
    }

    chatLog.info('Chat run started', {
      mode: this.mode,
      model: modelOverride,
      provider: providerOverride,
      preview: text.slice(0, 100),
    });
    this.running = true;
    this.activeTools.clear();
    this.turnAssistantText = '';
    this.inlineToolJsonBuffer = '';
    toolIdCounter = 0;

    const greeting = isSimpleGreeting(text);
    if (greeting) {
      this.threadId = undefined;
      this.history.setThreadId(undefined);
    }

    /** Tab chips from **Tabs** apply to this message only (not every later send). */
    const sendTargets = greeting ? [] : [...this.targetFiles];
    if (!greeting && sendTargets.length) {
      this.targetFiles = [];
      this.refreshTargets();
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
      for (const f of sendTargets) {
        if (contextMap.size >= maxAtt) break;
        contextMap.set(`file:${f}`, {
          type: 'file',
          label: f,
          path: f,
          content: `(edit target: ${f})`,
        });
      }
      contextItems = [...contextMap.values()];
      chatLog.debug('Context attachments', {
        count: contextItems.length,
        labels: contextItems.map((c) => c.label),
      });
    } catch (err) {
      chatLog.warn('Context resolution failed, using pinned only', err);
      contextItems = getPendingContext();
    }

    const userAttachments = greeting
      ? []
      : buildUserAttachments(contextItems, sendTargets);

    const userTs = Date.now();
    this.history.append({
      kind: 'user',
      text,
      mode: this.mode,
      ts: userTs,
      attachments: userAttachments.length ? userAttachments : undefined,
    });

    this.post({
      type: 'user',
      text,
      attachments: userAttachments,
      mode: this.mode,
    });

    this.post({
      type: 'runStart',
      label: this.mode === 'plan' ? 'Planning' : 'Thinking',
    });

    if (!greeting && (sendTargets.length > 0 || this.mode === 'agent')) {
      saveCheckpoint('pre-edit');
    }

    const composerFiles = !greeting && sendTargets.length > 0 ? [...sendTargets] : undefined;
    let errorMessage: string | undefined;
    let toolsRan = 0;

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
          this.inlineToolJsonBuffer += d.text;
          if (!mightBeLeakedToolText(this.inlineToolJsonBuffer)) {
            this.post({ type: 'text', text: d.text });
          }
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
          chatLog.info('Tool start', { id, name: d.name, path: d.args?.path });
          this.activeTools.set(id, { name: d.name, args: d.args ?? {} });
          this.post({ type: 'toolStart', id, name: d.name, args: d.args ?? {} });
        }

        if (event.type === 'tool_end') {
          const d = event.data as {
            id?: string;
            name: string;
            result: string;
            writtenPath?: string;
            writtenContents?: string;
          };
          const id = d.id ?? [...this.activeTools.keys()].pop() ?? `t-${toolIdCounter}`;
          const tool = this.activeTools.get(id) ?? { name: d.name, args: {} };
          const ok = !d.result.startsWith('Error:') && !d.result.startsWith('Rejected');
          const args =
            d.writtenContents && tool.name === 'write_file'
              ? { ...tool.args, path: d.writtenPath ?? tool.args.path, contents: d.writtenContents }
              : tool.args;
          this.post({
            type: 'toolEnd',
            id,
            name: tool.name,
            args,
            result: d.result,
            ok,
          });
          chatLog.info('Tool end', {
            id,
            name: d.name,
            ok,
            resultPreview: d.result.slice(0, 200),
          });
          this.saveToolToHistory(id, tool.name, args, d.result, ok);
          this.activeTools.delete(id);
          if (ok) toolsRan++;
        }

        if (event.type === 'diff') {
          const d = event.data as { file: string; oldContent: string; newContent: string };
          this.post({ type: 'diff', file: d.file });
          void addPendingDiff(d).then(() => this.refreshPendingDiffs());
          const note =
            `\n\n**Proposed change:** \`${d.file}\` — **Accept** applies it, **Reject** discards it (nothing is saved until you Accept).\n`;
          this.turnAssistantText += note;
          this.post({ type: 'text', text: note });
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
          chatLog.error('Agent error event', d.message);
          this.post({ type: 'error', message: d.message });
        }
      }
      if (
        !errorMessage &&
        toolsRan === 0 &&
        /\b(create|add|implement|new)\b/i.test(text) &&
        /\b(service|client|library|module)\b/i.test(text) &&
        (/Let's start by|you can follow these steps|To create a new shared|^\s*\d+\.\s+/im.test(
          this.turnAssistantText
        ) ||
          /^\s*\d+\.\s+/m.test(this.turnAssistantText))
      ) {
        errorMessage =
          'The model stopped after a tutorial-style reply and did not run any tools. ' +
          'Reload after updating Rubynod, then retry with **qwen2.5-coder** (7b).';
        this.post({ type: 'error', message: errorMessage });
      }
      if (!errorMessage && toolsRan === 0 && /read_file path is required|Received null/i.test(this.turnAssistantText)) {
        errorMessage =
          'Tools failed because the model did not send a file path. Reload the window after updating Rubynod, then retry. ' +
          'For booking-api-client, the agent should use shared/booking-api-client.service.ts.';
      }
      if (
        !errorMessage &&
        toolsRan === 0 &&
        (/@\S+\.[a-z0-9]{1,8}/i.test(text) ||
          /\b(?:service|client)\b/i.test(text)) &&
        (/```json|^\s*json\s*$|\{\s*"name/im.test(this.turnAssistantText) ||
          !this.turnAssistantText.trim())
      ) {
        errorMessage =
          'No file changes were applied. The model only returned broken tool JSON or tutorial text. ' +
          'Reload the window, then retry with **qwen2.5-coder** in Agent mode.';
        chatLog.warn('Chat finished with no tools and leaked JSON in UI', {
          preview: this.turnAssistantText.slice(0, 100),
        });
        this.post({ type: 'error', message: errorMessage });
      }
      chatLog.info('Chat run finished', { threadId: this.threadId, error: !!errorMessage, toolsRan });
    } catch (e) {
      errorMessage = formatAiConnectionError(e);
      chatLog.error('Chat run exception', e);
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
