import * as path from 'node:path';
import * as vscode from 'vscode';
import { ChatViewProvider } from './chat-provider';
import { attachTerminalListener } from './bridge';
import { startBridgeServer, stopBridgeServer } from './bridge-server';
import { runInlineEdit } from './inline-edit';
import { registerTabAutocomplete } from './tab-complete';
import { acceptDiff, rejectDiff, undoLastCheckpoint } from './diff-manager';
import { pickContext } from './context';
import { getServiceUrl, getWorkspaceRoot, isLazyStart } from './settings';
import { attachmentFromUri } from './file-context';
import { attachmentFromFolder } from './folder-context';
import { setChatProviderRef, getChatProviderRef } from './chat-provider';
import { IndexService } from './index-service';
import { UpdateChecker } from './update-checker';
import { OllamaConnect } from './ollama-connect';
import { killStaleProcessOnAiPort, startAiService, stopAiService } from './ai-service';
import { configureRubynod, ensureRubynodReady } from './rubynod-ready';
import { extLog, getRubynodLogLevel, showRubynodOutput } from './logger';
import {
  openAllRubynodSettings,
  openIndexingSettings,
  openMcpConfig,
  openRulesConfig,
  openSkillsConfig,
} from './agent-config';

let chatProvider: ChatViewProvider;
let indexService: IndexService;
let updateChecker: UpdateChecker;
let ollamaConnect: OllamaConnect;

function findDuplicateRubynodExtensions(selfId: string): string[] {
  return vscode.extensions.all
    .filter((ext) => {
      if (ext.id === selfId) return false;
      const views = ext.packageJSON?.contributes?.views as
        | Record<string, Array<{ id?: string }>>
        | undefined;
      if (!views?.['rubynod-ai']) return false;
      return views['rubynod-ai'].some((v) => v.id === 'rubynod.chatView');
    })
    .map((ext) => ext.id);
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((x) => parseInt(x, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** When several Rubynod copies are installed, only the newest version should activate. */
function isNewestRubynodCopy(selfId: string, selfVersion: string): boolean {
  const duplicates = findDuplicateRubynodExtensions(selfId);
  if (duplicates.length === 0) return true;
  const versionOf = (id: string) =>
    String(vscode.extensions.getExtension(id)?.packageJSON?.version ?? '0.0.0');
  let newestId = selfId;
  let newestVer = selfVersion;
  for (const id of duplicates) {
    const v = versionOf(id);
    if (compareSemver(v, newestVer) > 0) {
      newestId = id;
      newestVer = v;
    }
  }
  return newestId === selfId;
}

function warmStartAiInBackground(): void {
  void (async () => {
    const ok = await ensureRubynodReady();
    if (!ok) {
      extLog.error('Background AI start failed — open Output → Rubynod');
    }
    await getChatProviderRef()?.refreshPanel();
  })();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const selfVersion = String(context.extension.packageJSON.version ?? '0.0.0');
  extLog.info(`Activate v${selfVersion}`, {
    logLevel: getRubynodLogLevel(),
    workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });
  if (getRubynodLogLevel() === 'debug') {
    showRubynodOutput(true);
  }
  const duplicates = findDuplicateRubynodExtensions(context.extension.id);

  if (duplicates.length > 0 && !isNewestRubynodCopy(context.extension.id, selfVersion)) {
    extLog.warn(`Skipping activate for v${selfVersion} — newer duplicate installed`);
    return;
  }

  if (duplicates.length > 0) {
    void vscode.window.showWarningMessage(
      `Multiple Rubynod AI extensions detected (${duplicates.join(', ')}). ` +
        `Using v${selfVersion}. Uninstall older copies in Extensions.`
    );
  }

  attachTerminalListener();

  const bridgePort = await startBridgeServer();
  extLog.info('Extension ready', { bridgePort, extensionPath: context.extensionPath });
  configureRubynod(context.extensionPath, bridgePort);

  // After extension update, a detached server may still run outdated agent code on :3847.
  const lastAiVersion = context.globalState.get<string>('rubynod.aiServiceExtensionVersion');
  if (lastAiVersion !== selfVersion) {
    killStaleProcessOnAiPort();
    await stopAiService().catch(() => {});
    await context.globalState.update('rubynod.aiServiceExtensionVersion', selfVersion);
  }

  chatProvider = new ChatViewProvider(context.extensionUri, context);
  setChatProviderRef(chatProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      // false = reload webview after extension update so status/models messages are not lost
      webviewOptions: { retainContextWhenHidden: false },
    })
  );

  if (!isLazyStart()) {
    warmStartAiInBackground();
  }

  setTimeout(() => void getChatProviderRef()?.refreshPanel(), 1500);
  setTimeout(() => void getChatProviderRef()?.refreshPanel(), 5000);

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
    vscode.commands.registerCommand('rubynod.startAiService', () =>
      startAiService(context.extensionPath)
    ),
    vscode.commands.registerCommand('rubynod.stopAiService', () => stopAiService()),
    vscode.commands.registerCommand('rubynod.showLogs', () => showRubynodOutput(false)),
    vscode.commands.registerCommand('rubynod.openSettings', () => {
      openAllRubynodSettings(context.extension.id);
    }),
    vscode.commands.registerCommand('rubynod.openIndexingSettings', () => {
      openIndexingSettings(context.extension.id);
    }),
    vscode.commands.registerCommand('rubynod.openRulesConfig', () => {
      void openRulesConfig();
    }),
    vscode.commands.registerCommand('rubynod.openSkillsConfig', () => {
      void openSkillsConfig();
    }),
    vscode.commands.registerCommand('rubynod.openMcpConfig', () => {
      void openMcpConfig();
    }),
    vscode.commands.registerCommand('rubynod.openChat', async () => {
      await vscode.commands.executeCommand('rubynod.chatView.focus');
      void ensureRubynodReady();
    }),
    vscode.commands.registerCommand('rubynod.newChat', async () => {
      await getChatProviderRef()?.startNewChat();
    }),
    vscode.commands.registerCommand('rubynod.clearChat', async () => {
      const ok = await vscode.window.showWarningMessage(
        'Clear all chat history for this workspace?',
        { modal: true },
        'Clear'
      );
      if (ok === 'Clear') await getChatProviderRef()?.clearHistory();
    }),
    vscode.commands.registerCommand('rubynod.openComposer', async () => {
      await vscode.commands.executeCommand('rubynod.chatView.focus');
      void ensureRubynodReady();
    }),
    vscode.commands.registerCommand('rubynod.inlineEdit', async () => {
      if (await ensureRubynodReady()) await runInlineEdit();
    }),
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
      if (!(await ensureRubynodReady())) {
        vscode.window.showWarningMessage('Rubynod AI service is offline.');
        return;
      }
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
  // Child AI process is detached — keep it alive across extension-host reloads.
  // In-process mode stops with the host; explicit stop via rubynod.stopAiService.
}
