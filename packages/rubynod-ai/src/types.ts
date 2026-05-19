export type AgentMode = 'agent' | 'plan' | 'ask' | 'debug';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ContextAttachment {
  type: 'file' | 'folder' | 'codebase' | 'selection' | 'open' | 'terminal' | 'git' | 'rules' | 'symbols' | string;
  label: string;
  content: string;
  path?: string;
  startLine?: number;
  endLine?: number;
}

export interface ClientSettings {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  defaultMode?: string;
  maxAgentTurns?: number;
  privacyMode?: boolean;
  localIndexOnly?: boolean;
  maxFileContextChars?: number;
  maxContextAttachments?: number;
  mcpEnabled?: boolean;
  yoloMode?: boolean;
  autoIndexContext?: boolean;
  maxAutoContextChunks?: number;
  maxAutoContextChars?: number;
  contextCacheTtlSec?: number;
  webSearchEnabled?: boolean;
}

export interface AgentRequest {
  threadId?: string;
  message: string;
  mode?: AgentMode;
  workspaceRoot: string;
  model?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  context?: ContextAttachment[];
  composerFiles?: string[];
  clientSettings?: ClientSettings;
  bridgeUrl?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentEvent {
  type:
    | 'text'
    | 'tool_start'
    | 'tool_end'
    | 'diff'
    | 'error'
    | 'done'
    | 'plan'
    | 'thinking'
    | 'activity'
    | 'thought';
  data: unknown;
}

export interface IdeBridge {
  readFile(path: string, offset?: number, limit?: number): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  searchReplace(path: string, oldText: string, newText: string, replaceAll?: boolean): Promise<string>;
  glob(pattern: string, cwd?: string): Promise<string[]>;
  grep(pattern: string, path?: string): Promise<string>;
  listDir(path: string): Promise<string>;
  runTerminal(command: string, cwd?: string, blockUntilMs?: number): Promise<string>;
  readLints(paths?: string[]): Promise<string>;
  getOpenEditors(): Promise<string>;
  getSelection(): Promise<string>;
  getTerminalBuffer(): Promise<string>;
  getGitContext(): Promise<string>;
}

export interface ThreadState {
  id: string;
  mode: AgentMode;
  messages: ChatMessage[];
  workspaceRoot: string;
  cancelled: boolean;
  checkpoints: Array<{ label: string; files: Record<string, string> }>;
}
