import {
  getServiceUrl,
  getWorkspaceRoot,
  getClientSettings,
  getApiKey,
  getBaseUrl,
  isMcpEnabled,
  getInlineModel,
  getTabModel,
} from './settings';
import type { ContextAttachment } from './context';
import { getBridgePort } from './bridge-server';
import { agentLog } from './logger';
import { ensureRubynodReady } from './rubynod-ready';

export type AgentMode = 'agent' | 'plan' | 'ask' | 'debug';

export async function registerBridge(port: number): Promise<void> {
  agentLog.debug('Registering IDE bridge', { port, serviceUrl: getServiceUrl() });
  await fetch(`${getServiceUrl()}/bridge/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bridgeUrl: `http://127.0.0.1:${port}` }),
  });
}

export async function* streamAgent(opts: {
  message: string;
  mode: AgentMode;
  threadId?: string;
  context?: ContextAttachment[];
  composerFiles?: string[];
  /** Per-message model override (e.g. from chat model picker). */
  model?: string;
  /** Per-message provider override (ollama, openai, anthropic, openrouter). */
  provider?: string;
}): AsyncGenerator<{ type: string; data: unknown }> {
  await ensureRubynodReady();
  agentLog.info('Agent run started', {
    mode: opts.mode,
    model: opts.model,
    provider: opts.provider,
    threadId: opts.threadId,
    messagePreview: opts.message.slice(0, 120),
    contextCount: opts.context?.length ?? 0,
  });
  const clientSettings = getClientSettings();
  const model = opts.model?.trim() || clientSettings.model;
  const provider = (opts.provider?.trim() || clientSettings.provider) as typeof clientSettings.provider;
  const apiKey = await getApiKey();

  const res = await fetch(`${getServiceUrl()}/agent/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Rubynod-Bridge': `http://127.0.0.1:${getBridgePort()}`,
    },
    body: JSON.stringify({
      message: opts.message,
      mode: opts.mode,
      threadId: opts.threadId,
      workspaceRoot: getWorkspaceRoot(),
      provider,
      model,
      baseUrl: getBaseUrl(),
      apiKey,
      context: opts.context,
      composerFiles: opts.composerFiles,
      bridgeUrl: `http://127.0.0.1:${getBridgePort()}`,
      clientSettings: {
        ...clientSettings,
        provider,
        model,
        mcpEnabled: isMcpEnabled(),
        apiKey,
      },
    }),
  });

  if (!res.ok || !res.body) {
    agentLog.error('Agent HTTP failed', { status: res.status, url: `${getServiceUrl()}/agent/run` });
    throw new Error(`Agent request failed: ${res.status}`);
  }

  agentLog.debug('Agent SSE stream open');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as { type: string; data: unknown };
          agentLog.debug('SSE event', { type: event.type });
          yield event;
        } catch (err) {
          agentLog.warn('SSE parse failed', {
            line: line.slice(0, 200),
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
  if (buffer.startsWith('data: ')) {
    try {
      const event = JSON.parse(buffer.slice(6)) as { type: string; data: unknown };
      agentLog.debug('SSE event (tail)', { type: event.type });
      yield event;
    } catch (err) {
      agentLog.warn('SSE tail parse failed', err instanceof Error ? err.message : String(err));
    }
  }
  agentLog.info('Agent run stream ended');
}

export async function cancelAgent(threadId: string): Promise<void> {
  await fetch(`${getServiceUrl()}/agent/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId }),
  });
}

export async function buildIndex(): Promise<void> {
  await fetch(`${getServiceUrl()}/index/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceRoot: getWorkspaceRoot() }),
  });
}

export async function inlineEditRequest(body: {
  workspaceRoot: string;
  filePath: string;
  selection: string;
  instruction: string;
}): Promise<Response> {
  await ensureRubynodReady();
  return fetch(`${getServiceUrl()}/inline-edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      model: getInlineModel(),
      apiKey: await getApiKey(),
    }),
  });
}

export async function tabCompleteRequest(prefix: string, suffix: string): Promise<Response> {
  await ensureRubynodReady();
  return fetch(`${getServiceUrl()}/tab-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prefix,
      suffix,
      model: getTabModel(),
      apiKey: await getApiKey(),
    }),
  });
}
