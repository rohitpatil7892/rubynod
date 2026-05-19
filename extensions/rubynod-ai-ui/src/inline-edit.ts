import * as vscode from 'vscode';
import { getWorkspaceRoot } from './settings';
import { inlineEditRequest } from './api';

export async function runInlineEdit(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  if (!selectedText) {
    vscode.window.showWarningMessage('Select code to edit inline');
    return;
  }

  const instruction = await vscode.window.showInputBox({
    prompt: 'Rubynod inline edit — describe the change',
    placeHolder: 'e.g. Add error handling',
  });
  if (!instruction) return;

  const filePath = vscode.workspace.asRelativePath(editor.document.uri);
  const res = await inlineEditRequest({
    workspaceRoot: getWorkspaceRoot(),
    filePath,
    selection: selectedText,
    instruction,
  });
  const json = (await res.json()) as { oldText: string; newText: string };

  const decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
  });

  await editor.edit((eb) => eb.replace(selection, json.newText));

  const accept = await vscode.window.showInformationMessage(
    'Apply inline edit?',
    'Accept',
    'Reject'
  );
  if (accept !== 'Accept') {
    await editor.edit((eb) => eb.replace(selection, json.oldText));
  }
  decoration.dispose();
}
