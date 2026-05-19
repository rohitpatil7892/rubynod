import * as vscode from 'vscode';
import {
  getServiceUrl,
  getWorkspaceRoot,
  getIndexSaveDebounceMs,
  getIndexBuildConcurrency,
  getSearchCandidateLimit,
  getStatusPollIntervalMs,
  isAutoIndexOnOpen,
  isAutoIndexOnSave,
} from './settings';

export class IndexService implements vscode.Disposable {
  private statusItem: vscode.StatusBarItem;
  private pollTimer?: ReturnType<typeof setInterval>;
  private pendingFiles = new Map<string, ReturnType<typeof setTimeout>>();
  private saveDebounceMs: number;

  constructor() {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.statusItem.command = 'rubynod.buildIndex';
    this.statusItem.tooltip = 'Rubynod codebase index — click to rebuild';
    this.statusItem.show();
    this.saveDebounceMs = getIndexSaveDebounceMs();
  }

  start(context: vscode.ExtensionContext): void {
    if (isAutoIndexOnOpen()) {
      void this.buildIndex(true);
    }

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme === 'file' && isAutoIndexOnSave()) {
          this.scheduleUpdate(doc);
        }
      })
    );

    const pollMs = getStatusPollIntervalMs();
    this.pollTimer = setInterval(() => void this.refreshStatus(), pollMs);
    void this.refreshStatus();
  }

  private scheduleUpdate(doc: vscode.TextDocument): void {
    const rel = vscode.workspace.asRelativePath(doc.uri);
    const existing = this.pendingFiles.get(rel);
    if (existing) clearTimeout(existing);

    this.pendingFiles.set(
      rel,
      setTimeout(() => {
        this.pendingFiles.delete(rel);
        void this.updateFile(doc);
      }, this.saveDebounceMs)
    );
  }

  async buildIndex(silent = false): Promise<void> {
    const ws = getWorkspaceRoot();
    const body = {
      workspaceRoot: ws,
      concurrency: getIndexBuildConcurrency(),
      searchCandidateLimit: getSearchCandidateLimit(),
    };

    const run = async () => {
      const res = await fetch(`${getServiceUrl()}/index/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { stats?: { chunkCount: number; fileCount: number } };
      await this.refreshStatus();
      if (!silent && json.stats) {
        vscode.window.showInformationMessage(
          `Rubynod index ready: ${json.stats.chunkCount} chunks from ${json.stats.fileCount} files`
        );
      }
    };

    if (silent) {
      await run().catch(() => this.setStatus('$(error) Index offline', true));
    } else {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Rubynod: Indexing codebase', cancellable: false },
        run
      );
    }
  }

  async updateFile(doc: vscode.TextDocument): Promise<void> {
    const ws = getWorkspaceRoot();
    const rel = vscode.workspace.asRelativePath(doc.uri);
    const symbols = await this.collectSymbols(doc);
    await fetch(`${getServiceUrl()}/index/update-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws, path: rel, symbols }),
    }).catch(() => {});
    void this.refreshStatus();
  }

  private async collectSymbols(doc: vscode.TextDocument): Promise<
    Array<{ path: string; name: string; kind: string; startLine: number; endLine: number; container?: string }>
  > {
    try {
      const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        doc.uri
      );
      if (!syms?.length) return [];
      const rel = vscode.workspace.asRelativePath(doc.uri);
      const flat: Array<{
        path: string;
        name: string;
        kind: string;
        startLine: number;
        endLine: number;
        container?: string;
      }> = [];

      const walk = (list: vscode.DocumentSymbol[], container?: string) => {
        for (const s of list) {
          flat.push({
            path: rel,
            name: s.name,
            kind: vscode.SymbolKind[s.kind] ?? 'symbol',
            startLine: s.range.start.line + 1,
            endLine: s.range.end.line + 1,
            container,
          });
          if (s.children?.length) walk(s.children, s.name);
        }
      };
      walk(syms);
      return flat;
    } catch {
      return [];
    }
  }

  async refreshStatus(): Promise<void> {
    try {
      const res = await fetch(
        `${getServiceUrl()}/index/status?workspaceRoot=${encodeURIComponent(getWorkspaceRoot())}`
      );
      const json = (await res.json()) as {
        ready?: boolean;
        stats?: { chunkCount: number; fileCount: number; symbolCount: number; indexing: boolean };
      };
      const s = json.stats;
      if (!s) {
        this.setStatus('$(database) Index —', true);
        return;
      }
      if (s.indexing) {
        this.setStatus('$(sync~spin) Indexing…', true);
        const fastPoll = getStatusPollIntervalMs() / 3;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => void this.refreshStatus(), Math.max(2000, fastPoll));
      } else if (json.ready) {
        this.setStatus(`$(database) Index: ${s.chunkCount} chunks`, false);
        const pollMs = getStatusPollIntervalMs();
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => void this.refreshStatus(), pollMs);
      } else {
        this.setStatus('$(warning) Index empty', true);
      }
    } catch {
      this.setStatus('$(error) Index offline', true);
    }
  }

  private setStatus(text: string, warn: boolean): void {
    this.statusItem.text = text;
    this.statusItem.backgroundColor = warn
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const t of this.pendingFiles.values()) clearTimeout(t);
    this.pendingFiles.clear();
    this.statusItem.dispose();
  }
}
