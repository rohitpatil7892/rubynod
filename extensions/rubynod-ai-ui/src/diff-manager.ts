import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getWorkspaceRoot, requiresFileApproval } from './settings';
import { writeWorkspaceFile } from './file-write';

export interface PendingDiff {
  file: string;
  oldContent: string;
  newContent: string;
  threadId?: string;
  /** True once the proposed content has been written to disk (legacy / auto-approve path). */
  applied?: boolean;
}

const pending = new Map<string, PendingDiff>();
const checkpoints: Array<{ label: string; files: Map<string, string> }> = [];

const PENDING_SCHEME = 'rubynod-pending';

const pendingContentProvider = new (class implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    const file = decodeURIComponent(uri.path.replace(/^\//, ''));
    const side = new URLSearchParams(uri.query).get('side');
    const d = pending.get(file);
    if (!d) return side === 'new' ? '(pending)' : '(missing)';
    return side === 'new' ? d.newContent : d.oldContent || '(new file)';
  }
})();

let providerRegistered = false;

function ensurePendingProvider(): void {
  if (providerRegistered) return;
  vscode.workspace.registerTextDocumentContentProvider(PENDING_SCHEME, pendingContentProvider);
  providerRegistered = true;
}

export async function addPendingDiff(diff: PendingDiff): Promise<void> {
  const entry: PendingDiff = { ...diff, applied: false };
  pending.set(diff.file, entry);

  if (!requiresFileApproval()) {
    await acceptDiff(diff.file);
    return;
  }

  ensurePendingProvider();
  showDiffReview(entry);
  void vscode.window
    .showInformationMessage(
      `Rubynod: proposed changes to ${path.basename(diff.file)}`,
      'Review in chat'
    )
    .then((choice) => {
      if (choice === 'Review in chat') {
        vscode.commands.executeCommand('rubynod.openChat');
      }
    });
}

function showDiffReview(diff: PendingDiff): void {
  const rel = diff.file;
  const left = vscode.Uri.parse(`${PENDING_SCHEME}:${encodeURIComponent(rel)}?side=old`);
  const right = vscode.Uri.parse(`${PENDING_SCHEME}:${encodeURIComponent(rel)}?side=new`);

  void vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    `Rubynod (proposed): ${path.basename(rel)}`
  );
}

export async function acceptDiff(file: string): Promise<void> {
  const d = pending.get(file);
  if (!d) return;
  if (!d.applied) {
    await writeWorkspaceFile(file, d.newContent);
    d.applied = true;
  }
  pending.delete(file);
  vscode.window.showInformationMessage(`Accepted changes: ${file}`);
}

export async function rejectDiff(file: string): Promise<void> {
  const d = pending.get(file);
  if (d) {
    const ws = getWorkspaceRoot();
    const abs = path.isAbsolute(file) ? file : path.join(ws, file);
    if (d.applied) {
      if (d.oldContent && fs.existsSync(abs)) {
        await writeWorkspaceFile(file, d.oldContent);
      } else if (!d.oldContent && fs.existsSync(abs)) {
        const uri = vscode.Uri.file(abs);
        await vscode.workspace.fs.delete(uri, { useTrash: true });
      }
    }
    // Staged-only (not applied): nothing on disk to revert
  }
  pending.delete(file);
  vscode.window.showInformationMessage(`Rejected changes: ${file}`);
}

export function saveCheckpoint(label: string): void {
  const files = new Map<string, string>();
  for (const ed of vscode.window.visibleTextEditors) {
    files.set(path.relative(getWorkspaceRoot(), ed.document.uri.fsPath), ed.document.getText());
  }
  checkpoints.push({ label, files });
}

export async function undoLastCheckpoint(): Promise<void> {
  const cp = checkpoints.pop();
  if (!cp) {
    vscode.window.showWarningMessage('No checkpoints');
    return;
  }
  for (const [rel, content] of cp.files) {
    await writeWorkspaceFile(rel, content);
  }
  vscode.window.showInformationMessage(`Restored checkpoint: ${cp.label}`);
}

export function getPendingDiffs(): PendingDiff[] {
  return [...pending.values()];
}
