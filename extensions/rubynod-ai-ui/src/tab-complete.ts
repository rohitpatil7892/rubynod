import * as vscode from 'vscode';
import { isTabAutocompleteEnabled, getTabDebounceMs } from './settings';
import { tabCompleteRequest } from './api';

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastSuggestion = '';
let inFlight = false;
let requestGen = 0;
let ghostDecoration: vscode.TextEditorDecorationType | undefined;

export function registerTabAutocomplete(context: vscode.ExtensionContext): void {
  if (!isTabAutocompleteEnabled()) return;
  const debounceMs = getTabDebounceMs();

  ghostDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editorGhostText.foreground'),
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (e) => {
      if (e.document.uri.scheme !== 'file') return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== e.document) return;

      clearTimeout(debounceTimer);
      const gen = ++requestGen;

      debounceTimer = setTimeout(async () => {
        if (inFlight || gen !== requestGen) return;
        const pos = editor.selection.active;
        const offset = editor.document.offsetAt(pos);
        const full = editor.document.getText();
        const prefix = full.slice(Math.max(0, offset - 2000), offset);
        const suffix = full.slice(offset, offset + 500);

        inFlight = true;
        try {
          const res = await tabCompleteRequest(prefix, suffix);
          if (gen !== requestGen) return;
          const json = (await res.json()) as { suggestion: string };
          if (!json.suggestion?.trim()) return;
          lastSuggestion = json.suggestion;

          ghostDecoration?.dispose();
          ghostDecoration = vscode.window.createTextEditorDecorationType({
            after: {
              contentText: json.suggestion.slice(0, 120),
              color: new vscode.ThemeColor('editorGhostText.foreground'),
            },
          });
          editor.setDecorations(ghostDecoration, [new vscode.Range(pos, pos)]);
        } catch {
          // service offline
        } finally {
          inFlight = false;
        }
      }, debounceMs);
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      requestGen++;
      lastSuggestion = '';
      if (ghostDecoration && vscode.window.activeTextEditor) {
        vscode.window.activeTextEditor.setDecorations(ghostDecoration, []);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rubynod.acceptTabSuggestion', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !lastSuggestion) return;
      const pos = editor.selection.active;
      await editor.edit((eb) => eb.insert(pos, lastSuggestion));
      lastSuggestion = '';
      requestGen++;
    })
  );

  context.subscriptions.push({ dispose: () => ghostDecoration?.dispose() });
}
