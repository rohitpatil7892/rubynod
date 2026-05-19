import { randomUUID } from 'node:crypto';
import { CodebaseIndexer } from '@rubynod/index';
import { McpHub } from '@rubynod/mcp';
import { buildSystemPrompt } from './rules.js';
import { getCachedContextPack, setCachedContextPack } from './context-cache.js';
import { queueIndexBuild } from './index-queue.js';
import { ModelRouter, resolveModelConfig } from './model-router.js';
import { getToolDefinitions, executeTool } from './tools.js';
import type {
  AgentEvent,
  AgentMode,
  AgentRequest,
  ChatMessage,
  ContextAttachment,
  IdeBridge,
  ThreadState,
} from './types.js';

const threads = new Map<string, ThreadState>();
const indexers = new Map<string, CodebaseIndexer>();

export function getThread(id: string): ThreadState | undefined {
  return threads.get(id);
}

export function cancelThread(id: string): void {
  const t = threads.get(id);
  if (t) t.cancelled = true;
}

function formatContext(ctx: ContextAttachment[]): string {
  if (!ctx?.length) return '';
  return ctx.map((c) => `## Context: ${c.type} — ${c.label}\n${c.content}`).join('\n\n');
}

export async function* runAgent(
  req: AgentRequest,
  bridge?: IdeBridge,
  onEvent?: (e: AgentEvent) => void
): AsyncGenerator<AgentEvent> {
  const threadId = req.threadId ?? randomUUID();
  let thread = threads.get(threadId);
  const mode: AgentMode = req.mode ?? thread?.mode ?? 'agent';

  if (!thread) {
    thread = {
      id: threadId,
      mode,
      messages: [],
      workspaceRoot: req.workspaceRoot,
      cancelled: false,
      checkpoints: [],
    };
    threads.set(threadId, thread);
  }

  thread.mode = mode;
  thread.cancelled = false;

  const cs = req.clientSettings;

  let indexer = indexers.get(req.workspaceRoot);
  if (!indexer) {
    indexer = new CodebaseIndexer(req.workspaceRoot);
    indexers.set(req.workspaceRoot, indexer);
  }

  if (!indexer.isReady() && !indexer.isIndexing()) {
    queueIndexBuild(req.workspaceRoot, indexer).catch(console.error);
  }

  const autoContext = cs?.autoIndexContext !== false;
  const contextAttachments = [...(req.context ?? [])];
  const cacheTtl = cs?.contextCacheTtlSec ?? 45;
  if (autoContext && req.message.trim().length > 3) {
    let pack = getCachedContextPack(req.workspaceRoot, req.message, cacheTtl);
    if (!pack && indexer.isReady()) {
      pack = indexer.getContextPack(req.message, {
        limit: cs?.maxAutoContextChunks ?? 8,
        maxChars: cs?.maxAutoContextChars ?? 24_000,
      });
      setCachedContextPack(req.workspaceRoot, req.message, pack, cacheTtl);
    }
    if (pack?.chunks.length) {
      contextAttachments.push({
        type: 'codebase',
        label: `@codebase (auto): ${pack.summary}`,
        content: pack.formatted,
      });
    }
  }

  const mcpHub = new McpHub();
  if (cs?.mcpEnabled !== false) {
    await mcpHub.connectAll(req.workspaceRoot).catch(console.error);
  }
  const config = resolveModelConfig({
    provider: (req.provider ?? cs?.provider) as 'openai' | undefined,
    model: req.model ?? cs?.model,
    baseUrl: req.baseUrl ?? cs?.baseUrl,
    apiKey: req.apiKey ?? cs?.apiKey,
    temperature: cs?.temperature,
    maxTokens: cs?.maxTokens,
  });
  const router = new ModelRouter(config);

  const userContent = formatContext(contextAttachments) + '\n\n' + req.message;
  thread.messages.push({ role: 'user', content: userContent });

  const system = buildSystemPrompt(req.workspaceRoot, mode);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...thread.messages,
  ];

  const maxTurns = cs?.maxAgentTurns ?? 25;
  for (let turn = 0; turn < maxTurns; turn++) {
    if (thread.cancelled) {
      yield { type: 'error', data: { message: 'Cancelled' } };
      break;
    }

    const tools = getToolDefinitions(thread.mode, mcpHub, {
      webSearch: cs?.webSearchEnabled || process.env.RUBYNOD_WEB_SEARCH === '1',
    });
    let assistantText = '';
    const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let streamedAnyText = false;

    yield {
      type: 'thinking',
      data: { label: turn === 0 ? 'Thinking' : 'Continuing', threadId },
    };

    try {
      for await (const chunk of router.streamChat(messages, tools)) {
        if (thread.cancelled) break;
        if (chunk.type === 'text' && chunk.text) {
          streamedAnyText = true;
          assistantText += chunk.text;
          const ev: AgentEvent = { type: 'text', data: { text: chunk.text, threadId } };
          onEvent?.(ev);
          yield ev;
        }
        if (chunk.type === 'tool_calls' && chunk.toolCalls) {
          pendingToolCalls.push(...chunk.toolCalls);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'error', data: { message: msg } };
      break;
    }

    if (pendingToolCalls.length === 0) {
      thread.messages.push({ role: 'assistant', content: assistantText });
      if (mode === 'plan' && assistantText) {
        yield { type: 'plan', data: { content: assistantText, threadId } };
      }
      break;
    }

    thread.messages.push({
      role: 'assistant',
      content: assistantText || `[Calling ${pendingToolCalls.map((t) => t.name).join(', ')}]`,
    });
    messages.push({
      role: 'assistant',
      content: assistantText || `[tool calls]`,
    });

    for (const tc of pendingToolCalls) {
      if (thread.cancelled) break;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      yield { type: 'tool_start', data: { id: tc.id, name: tc.name, args: parsed, threadId } };

      const result = await executeTool(tc.name, parsed, {
        mode: thread.mode,
        workspaceRoot: req.workspaceRoot,
        bridge,
        indexer,
        mcpHub,
        onModeSwitch: (m) => {
          thread!.mode = m;
        },
        onDiff: (file, oldC, newC) => {
          const ev: AgentEvent = {
            type: 'diff',
            data: { file, oldContent: oldC, newContent: newC, threadId },
          };
          onEvent?.(ev);
        },
      });

      yield { type: 'tool_end', data: { id: tc.id, name: tc.name, result, threadId } };

      const toolMsg: ChatMessage = {
        role: 'tool',
        content: result,
        toolCallId: tc.id,
        name: tc.name,
      };
      thread.messages.push(toolMsg);
      messages.push(toolMsg);
    }
  }

  await mcpHub.shutdown();
  yield { type: 'done', data: { threadId } };
}

export async function inlineEdit(
  workspaceRoot: string,
  filePath: string,
  selection: string,
  instruction: string,
  bridge?: IdeBridge,
  overrides?: { model?: string; apiKey?: string }
): Promise<{ oldText: string; newText: string }> {
  const config = resolveModelConfig({ model: overrides?.model, apiKey: overrides?.apiKey });
  const router = new ModelRouter(config);
  const fileContent = bridge
    ? await bridge.readFile(filePath)
    : (await import('node:fs')).readFileSync(
        (await import('node:path')).resolve(workspaceRoot, filePath),
        'utf8'
      );

  const prompt = `File: ${filePath}\n\nInstruction: ${instruction}\n\nSelection to edit:\n\`\`\`\n${selection}\n\`\`\`\n\nFull file for context:\n\`\`\`\n${fileContent.slice(0, 12000)}\n\`\`\`\n\nReturn ONLY the replacement for the selection.`;

  const newText = await router.complete([
    { role: 'system', content: 'You are an inline code editor. Output only the new code for the selection.' },
    { role: 'user', content: prompt },
  ]);

  return { oldText: selection, newText: newText.trim() };
}

export async function tabComplete(
  prefix: string,
  suffix: string,
  overrides?: { model?: string; apiKey?: string }
): Promise<string> {
  const router = new ModelRouter(resolveModelConfig({ model: overrides?.model, apiKey: overrides?.apiKey }));
  return router.fim(prefix, suffix);
}

export function saveCheckpoint(threadId: string, label: string, files: Record<string, string>): void {
  const t = threads.get(threadId);
  if (t) t.checkpoints.push({ label, files: { ...files } });
}

export function getCheckpoints(threadId: string) {
  return threads.get(threadId)?.checkpoints ?? [];
}
