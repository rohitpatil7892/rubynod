import * as vscode from 'vscode';
import {
  getAutoContextMode,
  getDefaultChatMode,
  getMaxContextAttachments,
  getMaxFileContextChars,
  getModel,
  getOllamaHost,
  getProvider,
  getServiceUrl,
  getTabDebounceMs,
  getTerminalAllowlist,
  isAutoApproveFileWrites,
  isAutoApproveTerminal,
  isIncludeActiveFile,
  isIncludeOpenFiles,
  isLazyStart,
  isLocalIndexOnly,
  isMcpEnabled,
  isOllamaAutoConnect,
  isPrivacyMode,
  isShowAiOfflineIndicator,
  isShowAiStatusBarIndicator,
  isShowExtensionVersion,
  isShowThinkingInChat,
  isTabAutocompleteEnabled,
  isTelemetryEnabled,
  isWebSearchEnabled,
  isYoloMode,
} from './settings';
import { CHAT_PROVIDERS } from './model-catalog';

export type SettingsFieldType = 'boolean' | 'string' | 'number' | 'enum' | 'models' | 'action';

export interface SettingsField {
  key: string;
  label: string;
  description?: string;
  type: SettingsFieldType;
  value?: string | number | boolean;
  enumOptions?: Array<{ value: string; label: string }>;
  action?: string;
  actionLabel?: string;
  min?: number;
  max?: number;
  sensitive?: boolean;
}

export type SettingsPanelKind = 'form' | 'index' | 'rules' | 'skills' | 'mcp';

export interface SettingsSection {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** Cursor-style custom panel instead of a flat field list. */
  panel?: SettingsPanelKind;
  fields?: SettingsField[];
}

export interface SettingsPanelState {
  version: string;
  serviceUrl: string;
  ollamaHost: string;
  activeSection?: string;
  sections: SettingsSection[];
}

export function buildSettingsPanelState(extensionVersion: string): SettingsPanelState {
  const cfg = vscode.workspace.getConfiguration('rubynod');
  const num = (key: string, fallback: number) => cfg.get<number>(key, fallback);
  const str = (key: string, fallback: string) => cfg.get<string>(key, fallback);
  const bool = (key: string, fallback: boolean) => cfg.get<boolean>(key, fallback);

  return {
    version: extensionVersion,
    serviceUrl: getServiceUrl(),
    ollamaHost: getOllamaHost(),
    sections: [
      {
        id: 'models',
        label: 'Models',
        icon: '◇',
        description: 'Choose your LLM provider and models for chat, tab completion, and inline edit.',
        fields: [
          {
            key: 'models.provider',
            label: 'Provider',
            type: 'enum',
            value: getProvider(),
            enumOptions: CHAT_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
          },
          {
            key: 'models.chatModel',
            label: 'Chat & agent model',
            description: 'Used for the Rubynod chat panel and agent tools.',
            type: 'models',
            value: getModel(),
          },
          {
            key: 'ollama.host',
            label: 'Ollama host',
            description: 'Local Ollama server (without /v1).',
            type: 'string',
            value: getOllamaHost(),
          },
          {
            key: 'ollama.autoConnect',
            label: 'Auto-select Ollama model on startup',
            type: 'boolean',
            value: isOllamaAutoConnect(),
          },
          {
            key: 'models.baseUrl',
            label: 'API base URL',
            description: 'OpenAI-compatible endpoint (Ollama default: port 11434/v1).',
            type: 'string',
            value: str('models.baseUrl', 'http://127.0.0.1:11434/v1'),
          },
          {
            key: 'models.apiKey',
            label: 'API key',
            description: 'For cloud providers (OpenAI, Anthropic, OpenRouter).',
            type: 'string',
            value: str('models.apiKey', ''),
            sensitive: true,
          },
          {
            key: 'models.temperature',
            label: 'Temperature',
            type: 'number',
            value: num('models.temperature', 0.2),
            min: 0,
            max: 2,
          },
          {
            key: 'models.maxTokens',
            label: 'Max tokens',
            type: 'number',
            value: num('models.maxTokens', 8192),
            min: 512,
            max: 128000,
          },
          {
            key: 'tab.enabled',
            label: 'Tab autocomplete',
            type: 'boolean',
            value: isTabAutocompleteEnabled(),
          },
          {
            key: 'models.tabModel',
            label: 'Tab model',
            description: 'Leave empty to use chat model.',
            type: 'string',
            value: str('models.tabModel', ''),
          },
          {
            key: 'tab.debounceMs',
            label: 'Tab debounce (ms)',
            type: 'number',
            value: getTabDebounceMs(),
            min: 100,
            max: 3000,
          },
          {
            key: 'models.inlineModel',
            label: 'Inline edit model (Cmd+K)',
            description: 'Leave empty to use chat model.',
            type: 'string',
            value: str('models.inlineModel', ''),
          },
        ],
      },
      {
        id: 'chat',
        label: 'Chat',
        icon: '💬',
        description: 'Composer behavior, context attachments, and UI preferences.',
        fields: [
          {
            key: 'chat.defaultMode',
            label: 'Default mode',
            type: 'enum',
            value: getDefaultChatMode(),
            enumOptions: [
              { value: 'agent', label: 'Agent' },
              { value: 'plan', label: 'Plan' },
              { value: 'ask', label: 'Ask' },
              { value: 'debug', label: 'Debug' },
            ],
          },
          {
            key: 'chat.autoContext',
            label: 'Auto context mode',
            type: 'enum',
            value: getAutoContextMode(),
            enumOptions: [
              { value: 'coding', label: 'Coding — file + diagnostics + index' },
              { value: 'minimal', label: 'Minimal — index only' },
              { value: 'off', label: 'Off — manual @ only' },
            ],
          },
          {
            key: 'chat.includeActiveFile',
            label: 'Include active file in context',
            type: 'boolean',
            value: isIncludeActiveFile(),
          },
          {
            key: 'chat.includeOpenFiles',
            label: 'Include open editors in context',
            type: 'boolean',
            value: isIncludeOpenFiles(),
          },
          {
            key: 'chat.maxFileContextChars',
            label: 'Max chars per attached file',
            type: 'number',
            value: getMaxFileContextChars(),
            min: 4000,
            max: 200000,
          },
          {
            key: 'chat.maxContextAttachments',
            label: 'Max context attachments',
            type: 'number',
            value: getMaxContextAttachments(),
            min: 1,
            max: 50,
          },
          {
            key: 'ui.showThinkingInChat',
            label: 'Show thinking panel in chat thread',
            type: 'boolean',
            value: isShowThinkingInChat(),
          },
          {
            key: 'ui.showAiOfflineIndicator',
            label: 'Show online/offline badge in composer',
            type: 'boolean',
            value: isShowAiOfflineIndicator(),
          },
          {
            key: 'ui.showAiStatusBarIndicator',
            label: 'Show status in VS Code status bar',
            type: 'boolean',
            value: isShowAiStatusBarIndicator(),
          },
          {
            key: 'ui.showExtensionVersion',
            label: 'Show extension version in composer',
            type: 'boolean',
            value: isShowExtensionVersion(),
          },
        ],
      },
      {
        id: 'agent',
        label: 'Agent',
        icon: '✦',
        description: 'Tool execution, approvals, and safety for autonomous coding.',
        fields: [
          {
            key: 'agent.maxTurns',
            label: 'Max agent turns per request',
            type: 'number',
            value: num('agent.maxTurns', 25),
            min: 1,
            max: 100,
          },
          {
            key: 'agent.yoloMode',
            label: 'YOLO mode',
            description: 'Auto-approve terminal and file writes. Trusted repos only.',
            type: 'boolean',
            value: isYoloMode(),
          },
          {
            key: 'agent.autoApproveTerminal',
            label: 'Auto-approve terminal commands',
            type: 'boolean',
            value: isAutoApproveTerminal(),
          },
          {
            key: 'agent.autoApproveFileWrites',
            label: 'Auto-approve file writes',
            type: 'boolean',
            value: isAutoApproveFileWrites(),
          },
          {
            key: 'agent.terminalAllowlist',
            label: 'Terminal allowlist',
            description: 'Comma-separated command prefixes allowed without prompt.',
            type: 'string',
            value: getTerminalAllowlist().join(', '),
          },
          {
            key: 'tools.webSearch',
            label: 'Enable web search tool',
            type: 'boolean',
            value: isWebSearchEnabled(),
          },
          {
            key: 'mcp.enabled',
            label: 'Enable MCP tools',
            type: 'boolean',
            value: isMcpEnabled(),
          },
        ],
      },
      {
        id: 'indexing',
        label: 'Indexing',
        icon: '⌕',
        description: 'Semantic codebase index for @codebase and auto context.',
        panel: 'index',
      },
      {
        id: 'rules',
        label: 'Rules',
        icon: '📋',
        description: 'Instructions the agent always follows (project and global).',
        panel: 'rules',
      },
      {
        id: 'skills',
        label: 'Skills',
        icon: '⚡',
        description: 'Reusable agent workflows the model can invoke when relevant.',
        panel: 'skills',
      },
      {
        id: 'mcp',
        label: 'MCP',
        icon: '🔌',
        description: 'Model Context Protocol servers — databases, APIs, and tools.',
        panel: 'mcp',
      },
      {
        id: 'privacy',
        label: 'Privacy',
        icon: '🔒',
        description: 'Control what leaves your machine.',
        fields: [
          {
            key: 'privacy.privacyMode',
            label: 'Privacy mode',
            description: 'Avoid cloud embedders; prefer local index only.',
            type: 'boolean',
            value: isPrivacyMode(),
          },
          {
            key: 'privacy.localIndexOnly',
            label: 'Local index only',
            type: 'boolean',
            value: isLocalIndexOnly(),
          },
          {
            key: 'privacy.telemetry',
            label: 'Anonymous telemetry',
            type: 'boolean',
            value: isTelemetryEnabled(),
          },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced',
        icon: '⚙',
        description: 'Service URL, startup, and developer options.',
        fields: [
          {
            key: 'ai.serviceUrl',
            label: 'AI service URL',
            type: 'string',
            value: getServiceUrl(),
          },
          {
            key: 'ai.lazyStart',
            label: 'Lazy start AI service',
            description: 'Start agent only on first chat use (faster VS Code startup).',
            type: 'boolean',
            value: isLazyStart(),
          },
          {
            key: 'logging.level',
            label: 'Log level',
            type: 'enum',
            value: str('logging.level', 'info'),
            enumOptions: [
              { value: 'off', label: 'Off' },
              { value: 'error', label: 'Error' },
              { value: 'warn', label: 'Warn' },
              { value: 'info', label: 'Info' },
              { value: 'debug', label: 'Debug' },
            ],
          },
          {
            key: '_vscodeSettings',
            label: 'All VS Code settings',
            description: 'Open the full Rubynod settings JSON list.',
            type: 'action',
            action: 'openVscodeSettings',
            actionLabel: 'Open in Settings',
          },
        ],
      },
    ],
  };
}

export async function applySettingsField(
  key: string,
  value: unknown
): Promise<void> {
  if (key.startsWith('_')) return;

  if (key === 'agent.terminalAllowlist') {
    const list =
      typeof value === 'string'
        ? value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : Array.isArray(value)
          ? value.map(String)
          : [];
    await vscode.workspace
      .getConfiguration('rubynod')
      .update('agent.terminalAllowlist', list, vscode.ConfigurationTarget.Global);
    return;
  }

  await vscode.workspace
    .getConfiguration('rubynod')
    .update(key, value, vscode.ConfigurationTarget.Global);
}
