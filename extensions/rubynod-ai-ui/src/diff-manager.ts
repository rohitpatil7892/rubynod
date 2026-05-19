import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getWorkspaceRoot, isYoloMode, isAutoApproveFileWrites } from './settings';
import { writeWorkspaceFile } from './file-write';

export interface PendingDiff {
  file: string;
  oldContent: string;
  newContent: string;
  threadId?: string;
}

const pending = new Map<string, PendingDiff>();
const checkpoints: Array<{ label: string; files: Map<string, string> }> = [];

export async function addPendingDiff(diff: PendingDiff): Promise<void> {
  if (isYoloMode() || isAutoApproveFileWrites()) {
    pending.set(diff.file, diff);
    await acceptDiff(diff.file);
    return;
  }
  pending.set(diff.file, diff);
  showDiffReview(diff);
}

function showDiffReview(diff: PendingDiff): void {
  const ws = getWorkspaceRoot();
  const abs = path.isAbsolute(diff.file) ? diff.file : path.join(ws, diff.file);
  const left = vscode.Uri.parse(`rubynod-diff:${diff.file}?side=left`);
  const right = vscode.Uri.file(abs);

  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string {
      return diff.oldContent || '(new file)';
    }
  })();

  const reg = vscode.workspace.registerTextDocumentContentProvider('rubynod-diff', provider);
  vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    `Rubynod: ${path.basename(diff.file)}`
  );
  setTimeout(() => reg.dispose(), 60_000);
}

export async function acceptDiff(file: string): Promise<void> {
  const d = pending.get(file);
  if (!d) return;
  await writeWorkspaceFile(file, d.newContent);
  pending.delete(file);
  vscode.window.showInformationMessage(`Accepted changes: ${file}`);
}

export async function rejectDiff(file: string): Promise<void> {
  const d = pending.get(file);
  if (d) {
    const ws = getWorkspaceRoot();
    const abs = path.isAbsolute(file) ? file : path.join(ws, file);
    if (d.oldContent && fs.existsSync(abs)) {
      await writeWorkspaceFile(file, d.oldContent);
    } else if (!d.oldContent && fs.existsSync(abs)) {
      const uri = vscode.Uri.file(abs);
      await vscode.workspace.fs.delete(uri, { useTrash: true });
    }
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
