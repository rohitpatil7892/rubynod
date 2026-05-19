import * as path from 'node:path';
import * as vscode from 'vscode';
import { ChatViewProvider } from './chat-provider';
import { attachTerminalListener } from './bridge';
import { registerBridge } from './api';
import { startBridgeServer, stopBridgeServer } from './bridge-server';
import { runInlineEdit } from './inline-edit';
import { registerTabAutocomplete } from './tab-complete';
import { acceptDiff, rejectDiff, undoLastCheckpoint } from './diff-manager';
import { pickContext } from './context';
import { getServiceUrl, getWorkspaceRoot } from './settings';
import { attachmentFromUri } from './file-context';
import { attachmentFromFolder } from './folder-context';
import { setChatProviderRef, getChatProviderRef } from './chat-provider';
import { IndexService } from './index-service';
import { UpdateChecker } from './update-checker';
import { OllamaConnect } from './ollama-connect';
import { isAiServiceHealthy, startAiService } from './ai-service';

let chatProvider: ChatViewProvider;
let indexService: IndexService;
let updateChecker: UpdateChecker;
let ollamaConnect: OllamaConnect;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  attachTerminalListener();

  const bridgePort = await startBridgeServer();
  try {
    await registerBridge(bridgePort);
  } catch {
    const start = 'Start AI Service';
    const msg = await vscode.window.showWarningMessage(
      `Rubynod AI service not reachable at ${getServiceUrl()}.`,
      start
    );
    if (msg === start) void startAiService();
  }

  if (!(await isAiServiceHealthy())) {
    void vscode.window.showInformationMessage(
      'Rubynod: start the AI agent service before chatting (Cmd+Shift+P → Rubynod: Start AI Service).'
    );
  }

  chatProvider = new ChatViewProvider(context.extensionUri, context);
  setChatProviderRef(chatProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
  );

  registerTabAutocomplete(context);

  indexService = new IndexService();
  indexService.start(context);
  context.subscriptions.push(indexService);

  updateChecker = new UpdateChecker(context.extension.packageJSON.version as string);
  updateChecker.start(context);
  context.subscriptions.push(updateChecker);

  ollamaConnect = new OllamaConnect();
  ollamaConnect.start(context);
  context.subscriptions.push(ollamaConnect);

  const addToChat = async (uri?: vscode.Uri, range?: vscode.Range) => {
    const target =
      uri ??
      vscode.window.activeTextEditor?.document.uri ??
      (await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false }))?.[0];
    if (!target) return;
    const sel = range ?? vscode.window.activeTextEditor?.selection;
    const att = await attachmentFromUri(target, sel);
    if (att) {
      chatProvider.addAttachments([att]);
      await vscode.commands.executeCommand('rubynod.chatView.focus');
      vscode.window.showInformationMessage(`Added to chat: ${att.label}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('rubynod.startAiService', () => startAiService()),
    vscode.commands.registerCommand('rubynod.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:rubynod.rubynod-ai-ui');
    }),
    vscode.commands.registerCommand('rubynod.openChat', () => {
      vscode.commands.executeCommand('rubynod.chatView.focus');
    }),
    vscode.commands.registerCommand('rubynod.clearChat', async () => {
      const ok = await vscode.window.showWarningMessage(
        'Clear all chat history for this workspace?',
        { modal: true },
        'Clear'
      );
      if (ok === 'Clear') await getChatProviderRef()?.clearHistory();
    }),
    vscode.commands.registerCommand('rubynod.openComposer', () => {
      vscode.commands.executeCommand('rubynod.chatView.focus');
    }),
    vscode.commands.registerCommand('rubynod.inlineEdit', runInlineEdit),
    vscode.commands.registerCommand('rubynod.addFileToChat', () => addToChat()),
    vscode.commands.registerCommand('rubynod.addToChat', (uri: vscode.Uri) => addToChat(uri)),
    vscode.commands.registerCommand('rubynod.addSelectionToChat', () => {
      const ed = vscode.window.activeTextEditor;
      if (ed) addToChat(ed.document.uri, ed.selection);
    }),
    vscode.commands.registerCommand('rubynod.addFolderToChat', async (uri: vscode.Uri) => {
      const target = uri ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false }))?.[0];
      if (!target) return;
      const rel = vscode.workspace.asRelativePath(target);
      const att = await attachmentFromFolder(rel);
      if (att) {
        chatProvider.addAttachments([att]);
        await vscode.commands.executeCommand('rubynod.chatView.focus');
        vscode.window.showInformationMessage(`Added folder to chat: ${rel}/`);
      }
    }),
    vscode.commands.registerCommand('rubynod.buildIndex', async () => {
      await indexService.buildIndex(false);
    }),
    vscode.commands.registerCommand('rubynod.acceptDiff', async () => {
      const file = await vscode.window.showInputBox({ prompt: 'File path to accept' });
      if (file) await acceptDiff(file);
    }),
    vscode.commands.registerCommand('rubynod.rejectDiff', async () => {
      const file = await vscode.window.showInputBox({ prompt: 'File path to reject' });
      if (file) await rejectDiff(file);
    }),
    vscode.commands.registerCommand('rubynod.undoCheckpoint', undoLastCheckpoint),
    vscode.commands.registerCommand('rubynod.addMemory', async () => {
      const text = await vscode.window.showInputBox({ prompt: 'Memory to remember across chats' });
      if (!text?.trim()) return;
      await fetch(`${getServiceUrl()}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceRoot: getWorkspaceRoot(), text }),
      });
      vscode.window.showInformationMessage('Rubynod memory saved');
    }),
    vscode.commands.registerCommand('rubynod.openGapAnalysis', async () => {
      const gapPath = path.normalize(
        path.join(context.extensionPath, '..', '..', 'docs', 'gap-analysis.md')
      );
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(gapPath));
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

}

export function deactivate(): void {
  stopBridgeServer();
}
