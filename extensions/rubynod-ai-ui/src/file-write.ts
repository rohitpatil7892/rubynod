import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getWorkspaceRoot } from './settings';
import { sanitizeWriteContent } from './sanitize-write';
import { prepareJsonWrite } from './json-write';

function resolveAbs(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(getWorkspaceRoot(), filePath);
}

function fullDocumentRange(doc: vscode.TextDocument): vscode.Range {
  if (doc.lineCount === 0) return new vscode.Range(0, 0, 0, 0);
  const last = doc.lineCount - 1;
  return new vscode.Range(0, 0, last, doc.lineAt(last).text.length);
}

/** Write file to disk and keep any open editor in sync (saved, not dirty). */
export async function writeWorkspaceFile(filePath: string, content: string): Promise<void> {
  const abs = resolveAbs(filePath);
  const previous = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
  const clean = prepareJsonWrite(filePath, sanitizeWriteContent(content), previous);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const uri = vscode.Uri.file(abs);

  const openDoc = vscode.workspace.textDocuments.find(
    (d) => d.uri.fsPath === abs && !d.isClosed
  );

  if (openDoc) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullDocumentRange(openDoc), clean);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(`Failed to apply edit: ${filePath}`);
    }
    const doc =
      vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs && !d.isClosed) ??
      openDoc;
    if (doc.isDirty) {
      await doc.save();
    }
    return;
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(clean, 'utf8'));
}
