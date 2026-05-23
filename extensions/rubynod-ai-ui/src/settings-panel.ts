import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  applySettingsField,
  buildSettingsPanelState,
} from './settings-panel-state';
import { getSettingsHtml } from './settings-ui';
import { resolveChatModelsForProvider } from './panel-models';
import {
  deleteConfigFile,
  ensureRuleFile,
  ensureSkillDir,
  fetchIndexStatus,
  listMcpServers,
  listRules,
  listSkills,
  setMcpServerDisabled,
} from './config-scanner';
import {
  getAutoContextMode,
  getEmbeddingModel,
  getEmbeddingProvider,
  getMaxAutoContextChars,
  getMaxAutoContextChunks,
  getProvider,
  getWorkspaceRoot,
  isAutoIndexContext,
  isAutoIndexOnOpen,
  isAutoIndexOnSave,
  isMcpEnabled,
} from './settings';
import { getChatProviderRef } from './chat-provider';

let panel: vscode.WebviewPanel | undefined;

export function openRubynodSettingsPanel(
  context: vscode.ExtensionContext,
  initialSection?: string
): void {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

  if (panel) {
    panel.reveal(column);
    if (initialSection) {
      panel.webview.postMessage({ type: 'navigate', section: initialSection });
    }
    void bootstrapSettingsWebview();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'rubynod.settings',
    'Rubynod Settings',
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );

  panel.onDidDispose(() => {
    panel = undefined;
  });

  panel.webview.onDidReceiveMessage((msg) => {
    void handleSettingsMessage(context, msg).catch((err) => {
      panel?.webview.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  });

  void refreshSettingsPanel(context, initialSection);
}

/** Push live lists / models to an already-open settings webview (no HTML reload). */
async function bootstrapSettingsWebview(): Promise<void> {
  if (!panel) return;
  try {
    const resolved = await resolveChatModelsForProvider(getProvider(), 12_000);
    panel.webview.postMessage({ type: 'models', models: resolved.models });
  } catch {
    panel.webview.postMessage({ type: 'models', models: [] });
  }
  await pushIndexStatus();
  await pushConfigLists();
}

async function refreshSettingsPanel(
  context: vscode.ExtensionContext,
  initialSection?: string
): Promise<void> {
  if (!panel) return;
  const version = String(context.extension.packageJSON.version ?? '0.0.0');
  const state = buildSettingsPanelState(version);
  if (initialSection) state.activeSection = initialSection;
  const nonce = String(Date.now());
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  panel.webview.html = getSettingsHtml(
    state,
    String(panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'settings-panel.js'))),
    String(panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'settings-panels.js'))),
    String(panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'settings-cursor.css'))),
    panel.webview.cspSource,
    nonce
  );
}

function getIndexSettingsPayload() {
  return {
    autoIndexOnOpen: isAutoIndexOnOpen(),
    autoIndexOnSave: isAutoIndexOnSave(),
    autoInjectContext: isAutoIndexContext(),
    embeddingProvider: getEmbeddingProvider(),
    embeddingModel: getEmbeddingModel(),
    maxAutoContextChunks: getMaxAutoContextChunks(),
    maxAutoContextChars: getMaxAutoContextChars(),
    autoContext: getAutoContextMode(),
  };
}

async function pushIndexStatus(): Promise<void> {
  if (!panel) return;
  const data = await fetchIndexStatus();
  panel.webview.postMessage({
    type: 'indexStatus',
    data: data
      ? {
          ready: data.ready,
          indexing: data.stats?.indexing,
          stats: data.stats,
          embeddingProvider: data.embeddingProvider,
          embeddingModel: data.embeddingModel,
          needsEmbeddingRebuild: data.needsEmbeddingRebuild,
        }
      : { offline: true },
    settings: getIndexSettingsPayload(),
  });
}

async function pushConfigLists(): Promise<void> {
  if (!panel) return;
  const root = getWorkspaceRoot();
  panel.webview.postMessage({ type: 'rulesList', items: listRules(root) });
  panel.webview.postMessage({ type: 'skillsList', items: listSkills(root) });
  panel.webview.postMessage({
    type: 'mcpList',
    items: listMcpServers(root),
    globalEnabled: isMcpEnabled(),
  });
}

async function handleSettingsMessage(
  context: vscode.ExtensionContext,
  msg: {
    type: string;
    key?: string;
    value?: unknown;
    action?: string;
    scope?: string;
    path?: string;
    id?: string;
    enabled?: boolean;
    section?: string;
  }
): Promise<void> {
  if (!panel) return;

  if (msg.type === 'close') {
    panel.dispose();
    return;
  }

  if (msg.type === 'ready') {
    await bootstrapSettingsWebview();
    return;
  }

  if (msg.type === 'refreshIndex') {
    await pushIndexStatus();
    return;
  }

  if (msg.type === 'refreshPanel') {
    await pushConfigLists();
    return;
  }

  if (msg.type === 'openPath' && msg.path) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.path));
    await vscode.window.showTextDocument(doc, { preview: false });
    return;
  }

  if (msg.type === 'set' && msg.key) {
    await applySettingsField(msg.key, msg.value);
    if (msg.key.startsWith('index.') || msg.key === 'chat.autoContext') {
      await pushIndexStatus();
    }
    if (msg.key === 'models.provider' || msg.key === 'models.chatModel') {
      await getChatProviderRef()?.refreshChatModels(
        msg.key === 'models.provider' ? String(msg.value) : undefined
      );
      if (msg.key === 'models.provider') {
        const resolved = await resolveChatModelsForProvider(String(msg.value));
        panel.webview.postMessage({ type: 'models', models: resolved.models });
      }
    }
    if (msg.key === 'mcp.enabled') {
      await pushConfigLists();
    }
    panel.webview.postMessage({ type: 'saved' });
    return;
  }

  if (msg.type === 'mcpToggle' && msg.id) {
    const root = getWorkspaceRoot();
    const item = listMcpServers(root).find((s) => s.id === msg.id);
    if (item) {
      setMcpServerDisabled(item.configPath, item.name, !msg.enabled);
      await pushConfigLists();
      panel.webview.postMessage({ type: 'saved' });
    }
    return;
  }

  if (msg.type === 'action' && msg.action) {
    const root = getWorkspaceRoot();
    switch (msg.action) {
      case 'buildIndex':
        await vscode.commands.executeCommand('rubynod.buildIndex');
        setTimeout(() => void pushIndexStatus(), 1500);
        break;
      case 'refreshIndex':
        await pushIndexStatus();
        break;
      case 'openRubynodignore': {
        const ignorePath = path.join(root, '.rubynodignore');
        if (!fs.existsSync(ignorePath)) {
          fs.writeFileSync(
            ignorePath,
            'node_modules/\ndist/\n.git/\n*.min.js\n',
            'utf8'
          );
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(ignorePath));
        await vscode.window.showTextDocument(doc, { preview: false });
        break;
      }
      case 'newRule': {
        const scope = (msg.scope === 'global' ? 'global' : 'project') as 'global' | 'project';
        const name = await vscode.window.showInputBox({
          prompt: 'Rule file name',
          placeHolder: 'my-rule',
          value: 'my-rule',
        });
        if (!name) break;
        const filePath = ensureRuleFile(root, scope, name);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc, { preview: false });
        await pushConfigLists();
        break;
      }
      case 'deleteRule':
        if (msg.path) {
          const ok = await vscode.window.showWarningMessage(
            `Delete rule file?\n${msg.path}`,
            { modal: true },
            'Delete'
          );
          if (ok === 'Delete') {
            deleteConfigFile(msg.path);
            await pushConfigLists();
          }
        }
        break;
      case 'newSkill': {
        const scope = (msg.scope === 'global' ? 'global' : 'project') as 'global' | 'project';
        const name = await vscode.window.showInputBox({
          prompt: 'Skill name',
          placeHolder: 'my-skill',
        });
        if (!name) break;
        const skillPath = ensureSkillDir(root, scope, name);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(skillPath));
        await vscode.window.showTextDocument(doc, { preview: false });
        await pushConfigLists();
        break;
      }
      case 'newMcpServer': {
        const mcpPath = path.join(root, '.rubynod', 'mcp.json');
        if (!fs.existsSync(mcpPath)) {
          const example = path.join(root, '.rubynod', 'mcp.json.example');
          if (fs.existsSync(example)) {
            fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
            fs.copyFileSync(example, mcpPath);
          } else {
            fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
            fs.writeFileSync(
              mcpPath,
              '{\n  "mcpServers": {\n    "example": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-example"]\n    }\n  }\n}\n',
              'utf8'
            );
          }
        }
        const name = await vscode.window.showInputBox({
          prompt: 'Server name (JSON key)',
          placeHolder: 'postgres',
        });
        if (name) {
          try {
            const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as {
              mcpServers?: Record<string, unknown>;
            };
            raw.mcpServers = raw.mcpServers ?? {};
            if (!raw.mcpServers[name]) {
              raw.mcpServers[name] = { command: 'npx', args: [] };
              fs.writeFileSync(mcpPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
            }
          } catch {
            vscode.window.showErrorMessage('Invalid mcp.json — fix JSON first.');
          }
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mcpPath));
        await vscode.window.showTextDocument(doc, { preview: false });
        await pushConfigLists();
        break;
      }
      case 'openVscodeSettings':
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          `@ext:${context.extension.id}`
        );
        break;
      default:
        break;
    }
  }
}
