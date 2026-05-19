import * as vscode from 'vscode';
import * as path from 'node:path';
import { getServiceUrl, getDefaultChatMode, isIncludeActiveFile, isIncludeOpenFiles, getMaxContextAttachments } from './settings';
import { createIdeBridge } from './bridge';
import { pickContext, type ContextAttachment } from './context';
import { streamAgent, cancelAgent, type AgentMode } from './api';
import { addPendingDiff } from './diff-manager';
import { addContext, clearContext, getPendingContext, removeContext, getChipsPayload } from './context-store';
import { attachmentFromUri, resolveParsedMentions, getActiveEditorAttachment } from './file-context';
import { getChatHtml } from './chat-ui';
import { suggestMentions } from './file-mention-picker';
import { resolveAtQuery } from './context-resolver';
import { getWorkspaceRoot } from './settings';

let toolIdCounter = 0;

function classifyTool(name: string): 'terminal' | 'edit' | 'read' | 'search' {
  if (name === 'run_terminal' || name === 'Shell') return 'terminal';
  if (name === 'write_file' || name === 'search_replace') return 'edit';
  if (name === 'grep' || name === 'glob' || name === 'codebase_search') return 'search';
  return 'read';
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rubynod.chatView';
  private view?: vscode.WebviewView;
  private threadId?: string;
  private mode: AgentMode = getDefaultChatMode();
  private running = false;
  private activeToolIds = new Map<string, string>();

  constructor(private readonly extUri: vscode.Uri) {}

  addAttachments(items: ContextAttachment[]): void {
    addContext(items);
    this.refreshChips();
  }

  private refreshChips(): void {
    this.post({ type: 'chips', items: getChipsPayload() });
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
  }

  private post(msg: unknown) {
    this.view?.webview.postMessage(msg);
  }

  private async onMessage(msg: {
    type: string;
    text?: string;
    mode?: AgentMode;
    label?: string;
    path?: string;
    startLine?: number;
    query?: string;
    paths?: string[];
  }) {
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
    if (msg.type === 'stop') {
      if (this.threadId) await cancelAgent(this.threadId).catch(() => {});
      this.running = false;
      this.post({ type: 'runEnd' });
      return;
    }
    if (msg.type === 'send' && msg.text) {
      this.mode = msg.mode ?? 'agent';
      await this.run(msg.text);
    }
  }

  async run(text: string) {
    if (this.running) return;
    this.running = true;
    this.activeToolIds.clear();
    toolIdCounter = 0;

    this.post({
      type: 'runStart',
      label: this.mode === 'plan' ? 'Planning' : 'Thinking',
    });

    let contextItems: ContextAttachment[] = [];
    try {
      const fromMentions = await resolveParsedMentions(text);
      const pinned = getPendingContext();
      const active = isIncludeActiveFile() ? await getActiveEditorAttachment() : null;
      let openFiles: ContextAttachment | null = null;
      if (isIncludeOpenFiles()) {
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
      contextItems = [...contextMap.values()];
    } catch {
      contextItems = getPendingContext();
    }

    try {
      for await (const event of streamAgent({
        message: text,
        mode: this.mode,
        threadId: this.threadId,
        context: contextItems,
      })) {
        if (event.type === 'text') {
          const d = event.data as { text: string; threadId?: string };
          if (d.threadId) this.threadId = d.threadId;
          this.post({ type: 'text', text: d.text });
        }

        if (event.type === 'thinking') {
          const d = event.data as { label?: string };
          this.post({
            type: 'runStart',
            label: d.label ?? (this.mode === 'plan' ? 'Planning' : 'Thinking'),
          });
        }

        if (event.type === 'tool_start') {
          const d = event.data as { id?: string; name: string; args: Record<string, unknown> };
          const id = d.id ?? `t-${++toolIdCounter}`;
          this.activeToolIds.set(id, d.name);
          this.post({ type: 'toolStart', id, name: d.name, args: d.args ?? {} });
        }

        if (event.type === 'tool_end') {
          const d = event.data as { id?: string; name: string; result: string };
          const id = d.id ?? [...this.activeToolIds.keys()].pop() ?? `t-${toolIdCounter}`;
          const ok = !d.result.startsWith('Error:') && !d.result.startsWith('Rejected');
          this.post({ type: 'toolEnd', id, name: d.name, result: d.result, ok });
        }

        if (event.type === 'diff') {
          const d = event.data as { file: string };
          this.post({ type: 'diff', file: d.file });
          void addPendingDiff(d as { file: string; oldContent: string; newContent: string });
        }

        if (event.type === 'plan') {
          const d = event.data as { content: string };
          this.post({ type: 'text', text: '\n\n---\n**Plan**\n\n' + d.content });
        }

        if (event.type === 'done') {
          const d = event.data as { threadId: string };
          this.threadId = d.threadId;
        }

        if (event.type === 'error') {
          const d = event.data as { message: string };
          this.post({ type: 'error', message: d.message });
        }
      }
    } catch (e) {
      this.post({
        type: 'error',
        message: `${e instanceof Error ? e.message : String(e)}\n\nStart AI service: npm run dev:ai (${getServiceUrl()})`,
      });
    } finally {
      this.post({ type: 'runEnd' });
      this.running = false;
      clearContext();
      this.post({ type: 'chips', items: [] });
    }
  }
}

let chatProviderRef: ChatViewProvider | undefined;

export function setChatProviderRef(p: ChatViewProvider): void {
  chatProviderRef = p;
}
