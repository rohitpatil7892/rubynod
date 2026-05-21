import * as vscode from 'vscode';

/** Client settings sent to the AI service. */
export interface RubynodClientSettings {
  provider: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
  defaultMode: string;
  maxAgentTurns: number;
  privacyMode: boolean;
  localIndexOnly: boolean;
  maxFileContextChars: number;
  maxContextAttachments: number;
  autoIndexContext: boolean;
  maxAutoContextChunks: number;
  maxAutoContextChars: number;
  contextCacheTtlSec: number;
  webSearchEnabled: boolean;
  indexBuildConcurrency: number;
  searchCandidateLimit: number;
}

function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('rubynod').get<T>(key, fallback);
}

export function getServiceUrl(): string {
  return cfg('ai.serviceUrl', 'http://127.0.0.1:3847');
}

/** When true, the AI agent starts on first chat/index/AI command (faster VS Code startup). */
export function isLazyStart(): boolean {
  return cfg('ai.lazyStart', true);
}

export async function getApiKey(): Promise<string | undefined> {
  const fromSetting = cfg<string>('models.apiKey', '');
  if (fromSetting) return fromSetting;
  const fromEnv =
    process.env.OPENAI_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENROUTER_API_KEY;
  if (fromEnv) return fromEnv;
  return vscode.workspace.getConfiguration('rubynod').get<string>('models.apiKeyFromEnv') || undefined;
}

export function getProvider(): string {
  return cfg('models.provider', 'ollama');
}

export function getModel(): string {
  return cfg('models.chatModel', 'llama3.2');
}

export function getOllamaHost(): string {
  return cfg('ollama.host', 'http://127.0.0.1:11434').replace(/\/$/, '');
}

export function isOllamaAutoConnect(): boolean {
  return cfg('ollama.autoConnect', true);
}

export function getTabModel(): string {
  const override = cfg('tab.model', '').trim();
  if (override) return override;
  const tab = cfg('models.tabModel', '').trim();
  if (tab) return tab;
  return getModel();
}

export function getInlineModel(): string {
  const override = cfg('inline.model', '');
  return override || cfg('models.inlineModel', getModel());
}

export function getBaseUrl(): string | undefined {
  const url = cfg('models.baseUrl', 'http://127.0.0.1:11434/v1');
  return url || undefined;
}

export function getDefaultChatMode(): 'agent' | 'plan' | 'ask' | 'debug' {
  return cfg<'agent' | 'plan' | 'ask' | 'debug'>('chat.defaultMode', 'agent');
}

export function isTabAutocompleteEnabled(): boolean {
  return cfg('tab.enabled', true);
}

export function getTabDebounceMs(): number {
  return cfg('tab.debounceMs', 600);
}

export function isIncludeActiveFile(): boolean {
  return cfg('chat.includeActiveFile', true);
}

export function isIncludeOpenFiles(): boolean {
  return cfg('chat.includeOpenFiles', false);
}

export function getMaxFileContextChars(): number {
  return cfg('chat.maxFileContextChars', 48_000);
}

export function getMaxContextAttachments(): number {
  return cfg('chat.maxContextAttachments', 20);
}

export function isAutoApproveTerminal(): boolean {
  return cfg('agent.autoApproveTerminal', false);
}

export function isAutoApproveFileWrites(): boolean {
  return cfg('agent.autoApproveFileWrites', false);
}

export function isYoloMode(): boolean {
  return cfg('agent.yoloMode', false);
}

export function isAutoIndexOnSave(): boolean {
  return cfg('index.autoIndexOnSave', true);
}

export function isAutoIndexOnOpen(): boolean {
  return cfg('index.autoIndexOnOpen', true);
}

export function isPrivacyMode(): boolean {
  return cfg('privacy.privacyMode', false);
}

export function isLocalIndexOnly(): boolean {
  return cfg('privacy.localIndexOnly', true);
}

export function isTelemetryEnabled(): boolean {
  return cfg('privacy.telemetry', false);
}

export function isMcpEnabled(): boolean {
  return cfg('mcp.enabled', true);
}

export function isAutoIndexContext(): boolean {
  return cfg('index.autoInjectContext', true);
}

export function getMaxAutoContextChunks(): number {
  return cfg('index.maxAutoContextChunks', 8);
}

export function getMaxAutoContextChars(): number {
  return cfg('index.maxAutoContextChars', 24_000);
}

export function getClientSettings(): RubynodClientSettings {
  return {
    provider: getProvider(),
    model: getModel(),
    baseUrl: getBaseUrl(),
    temperature: cfg('models.temperature', 0.2),
    maxTokens: cfg('models.maxTokens', 8192),
    defaultMode: getDefaultChatMode(),
    maxAgentTurns: cfg('agent.maxTurns', 25),
    privacyMode: isPrivacyMode(),
    localIndexOnly: isLocalIndexOnly(),
    maxFileContextChars: getMaxFileContextChars(),
    maxContextAttachments: getMaxContextAttachments(),
    autoIndexContext: isAutoIndexContext(),
    maxAutoContextChunks: getMaxAutoContextChunks(),
    maxAutoContextChars: getMaxAutoContextChars(),
    contextCacheTtlSec: getContextCacheTtlSec(),
    webSearchEnabled: isWebSearchEnabled(),
    indexBuildConcurrency: getIndexBuildConcurrency(),
    searchCandidateLimit: getSearchCandidateLimit(),
  };
}

export function getWorkspaceRoot(): string {
  return getWorkspaceRootForUri();
}

/** Multi-root: prefer folder of active editor, else first workspace folder */
export function getWorkspaceRootForUri(uri?: vscode.Uri): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return process.cwd();

  if (uri) {
    const match = vscode.workspace.getWorkspaceFolder(uri);
    if (match) return match.uri.fsPath;
  }

  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const match = vscode.workspace.getWorkspaceFolder(active);
    if (match) return match.uri.fsPath;
  }

  return folders[0]!.uri.fsPath;
}

export function getIndexSaveDebounceMs(): number {
  return cfg('performance.indexSaveDebounceMs', 800);
}

export function getIndexBuildConcurrency(): number {
  return cfg('performance.indexBuildConcurrency', 8);
}

export function getSearchCandidateLimit(): number {
  return cfg('performance.searchCandidateLimit', 400);
}

export function getContextCacheTtlSec(): number {
  return cfg('performance.contextCacheTtlSec', 45);
}

export function getStatusPollIntervalMs(): number {
  return cfg('performance.statusPollIntervalMs', 30_000);
}

export function isWebSearchEnabled(): boolean {
  return cfg('tools.webSearch', false);
}

export function getFolderContextMaxFiles(): number {
  return cfg('performance.folderContextMaxFiles', 30);
}
