import * as vscode from 'vscode';
import { pickContext, type ContextAttachment } from './context';
import { streamAgent } from './api';
import { addPendingDiff, saveCheckpoint, acceptDiff, rejectDiff, getPendingDiffs } from './diff-manager';

export class ComposerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rubynod.composerView';
  private view?: vscode.WebviewView;
  private threadId?: string;
  private targetFiles: string[] = [];

  constructor(private readonly extUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 8px; }
  h3 { margin: 0 0 8px; font-size: 14px; }
  #files { font-size: 12px; margin-bottom: 8px; min-height: 40px; background: var(--vscode-input-background); padding: 6px; border-radius: 4px; }
  #log { height: 50vh; overflow-y: auto; font-size: 12px; margin-bottom: 8px; }
  textarea { width: 100%; min-height: 80px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 8px; box-sizing: border-box; }
  .row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  button { padding: 6px 10px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; }
</style></head><body>
  <h3>Composer — multi-file edits</h3>
  <div id="files">No target files. Add from explorer or @file.</div>
  <div id="log"></div>
  <textarea id="prompt" placeholder="Describe multi-file changes..."></textarea>
  <div class="row">
    <button id="add-file">Add open files</button>
    <button id="ctx">@ Context</button>
    <button id="run">Run Composer</button>
    <button id="checkpoint">Save checkpoint</button>
    <button id="accept-all">Accept all diffs</button>
    <button id="reject-all">Reject all</button>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const filesEl = document.getElementById('files');
  document.getElementById('run').onclick = () => {
    vscode.postMessage({ type: 'run', prompt: document.getElementById('prompt').value });
  };
  document.getElementById('add-file').onclick = () => vscode.postMessage({ type: 'addOpenFiles' });
  document.getElementById('ctx').onclick = () => vscode.postMessage({ type: 'addContext' });
  document.getElementById('checkpoint').onclick = () => vscode.postMessage({ type: 'checkpoint' });
  document.getElementById('accept-all').onclick = () => vscode.postMessage({ type: 'acceptAll' });
  document.getElementById('reject-all').onclick = () => vscode.postMessage({ type: 'rejectAll' });
  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'log') {
      const p = document.createElement('p');
      p.textContent = m.text;
      log.appendChild(p);
      log.scrollTop = log.scrollHeight;
    }
    if (m.type === 'files') filesEl.textContent = m.files.join(', ') || 'No target files';
  });
</script>
</body></html>`;
  }

  private log(text: string) {
    this.view?.webview.postMessage({ type: 'log', text });
  }

  private async onMessage(msg: { type: string; prompt?: string }) {
    if (msg.type === 'addOpenFiles') {
      this.targetFiles = vscode.window.visibleTextEditors.map((e) =>
        vscode.workspace.asRelativePath(e.document.uri)
      );
      this.view?.webview.postMessage({ type: 'files', files: this.targetFiles });
    }
    if (msg.type === 'addContext') {
      await pickContext();
    }
    if (msg.type === 'checkpoint') {
      saveCheckpoint('composer-manual');
      this.log('Checkpoint saved');
    }
    if (msg.type === 'acceptAll') {
      for (const d of getPendingDiffs()) await acceptDiff(d.file);
      this.log('Accepted all pending diffs');
    }
    if (msg.type === 'rejectAll') {
      for (const d of getPendingDiffs()) await rejectDiff(d.file);
      this.log('Rejected all pending diffs');
    }
    if (msg.type === 'run' && msg.prompt) {
      saveCheckpoint('pre-composer');
      const ctx: ContextAttachment[] = [];
      for (const f of this.targetFiles) {
        ctx.push({ type: 'file', label: f, content: `(target file: ${f})` });
      }
      this.log(`Running composer on ${this.targetFiles.length} files...`);
      try {
        for await (const event of streamAgent({
          message: msg.prompt,
          mode: 'agent',
          threadId: this.threadId,
          context: ctx,
          composerFiles: this.targetFiles,
        })) {
          if (event.type === 'text') {
            const d = event.data as { text: string; threadId?: string };
            if (d.threadId) this.threadId = d.threadId;
            this.log(d.text);
          }
          if (event.type === 'diff') {
            const d = event.data as { file: string; oldContent: string; newContent: string };
            void addPendingDiff(d);
            this.log(`Diff ready: ${d.file} — review and Accept/Reject`);
          }
          if (event.type === 'done') this.log('Composer done');
        }
      } catch (e) {
        this.log(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
