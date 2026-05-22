import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodebaseIndexer } from '@rubynod/index';
import { McpHub } from '@rubynod/mcp';
import { buildSystemPrompt } from './rules.js';
import {
  buildFocusedFileDirective,
  hasExplicitFileMention,
  inspectWorkspaceSetup,
  shouldAttachWorkspaceSetup,
  shouldRequireAgentTools,
} from './project-context.js';
import { isFailedToolOnlyResponse } from './sanitize-code.js';
import { getCachedContextPack, setCachedContextPack } from './context-cache.js';
import { queueIndexBuild } from './index-queue.js';
import { ModelRouter, resolveModelConfig } from './model-router.js';
import {
  formatOllamaNoToolsModelError,
  ollamaHostFromBaseUrl,
  ollamaModelSupportsTools,
} from './ollama.js';
import { getToolDefinitions, executeTool } from './tools.js';
import {
  extractRecoveryToolCalls,
  extractToolCallsFromText,
  mightBeLeakedToolSyntax,
} from './text-tool-calls.js';
import {
  buildSkippedWriteFileHint,
  dedupePendingToolCalls,
  preparePendingToolCall,
  type PendingToolCall,
} from './prepare-pending-tool.js';
import {
  thinkingLabel,
  describeToolStart,
  describeToolEnd,
} from './agent-activity.js';
import { agentLog } from './logger.js';
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

  if (mode === 'agent' && shouldAttachWorkspaceSetup(req.message)) {
    contextAttachments.unshift({
      type: 'rules',
      label: 'Workspace setup',
      content: inspectWorkspaceSetup(req.workspaceRoot),
    });
  }
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

  let ollamaSupportsTools = true;
  if (config.provider === 'ollama' && config.model) {
    const host = ollamaHostFromBaseUrl(config.baseUrl);
    ollamaSupportsTools = await ollamaModelSupportsTools(config.model, host);
    if (!ollamaSupportsTools) {
      agentLog.warn('Ollama model does not support tools', { model: config.model, host });
    }
  }

  agentLog.info('runAgent start', {
    mode,
    model: config.model,
    provider: config.provider,
    workspaceRoot: req.workspaceRoot,
    messagePreview: req.message.slice(0, 100),
    contextAttachments: contextAttachments.length,
  });

  const userContent = formatContext(contextAttachments) + '\n\n' + req.message;
  thread.messages.push({ role: 'user', content: userContent });

  const trimmed = req.message.trim();
  const isGreeting =
    trimmed.length <= 48 &&
    /^(hi|hello|hey|howdy|yo|sup|thanks|thank you|good morning|good afternoon|good evening)[\s!.?,']*$/i.test(
      trimmed
    );

  let system = buildSystemPrompt(req.workspaceRoot, mode);
  const focusedFileHint = buildFocusedFileDirective(req.message);
  if (focusedFileHint) {
    system += `\n\n${focusedFileHint}`;
  }
  if (isGreeting) {
    system +=
      '\n\nThe user sent a brief greeting only. Reply in one or two friendly sentences. Do not call read_file or any other tools.';
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...thread.messages,
  ];

  const maxTurns = cs?.maxAgentTurns ?? 25;
  /** Per user message: track writes to block incremental tiny overwrites. */
  const writeStatsByPath = new Map<string, { chars: number; count: number }>();
  let toolsExecutedThisRun = 0;
  let retriedToolJson = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (thread.cancelled) {
      agentLog.warn('Agent cancelled', { threadId });
      yield { type: 'error', data: { message: 'Cancelled' } };
      break;
    }

    agentLog.debug('Agent turn', { turn, threadId });

    const tools = isGreeting
      ? []
      : getToolDefinitions(thread.mode, mcpHub, {
          webSearch: cs?.webSearchEnabled || process.env.RUBYNOD_WEB_SEARCH === '1',
        });

    if (config.provider === 'ollama' && !ollamaSupportsTools && tools.length > 0) {
      yield {
        type: 'error',
        data: { message: formatOllamaNoToolsModelError(config.model) },
      };
      break;
    }

    let assistantText = '';
    let cleanedDisplayLen = 0;
    let bufferingInlineToolJson = false;
    const pendingToolCalls: PendingToolCall[] = [];
    let streamedAnyText = false;

    const thinkId = `think-${turn}`;
    const thinkMeta = thinkingLabel(turn, mode);
    yield {
      type: 'activity',
      data: {
        id: thinkId,
        step: thinkMeta.step,
        label: thinkMeta.label,
        status: 'active',
        threadId,
      },
    };

    try {
      const toolChoice =
        !isGreeting && tools.length > 0
          ? shouldRequireAgentTools(req.message) && ollamaSupportsTools
            ? ('required' as const)
            : ('auto' as const)
          : undefined;

      for await (const chunk of router.streamChat(messages, tools, { toolChoice })) {
        if (thread.cancelled) break;
        if (chunk.type === 'text' && chunk.text) {
          assistantText += chunk.text;
          if (mightBeLeakedToolSyntax(assistantText)) {
            bufferingInlineToolJson = true;
          }
          const extracted = extractToolCallsFromText(
            assistantText,
            req.message,
            req.workspaceRoot
          );
          if (extracted.toolCalls.length) {
            bufferingInlineToolJson = false;
            for (const tc of extracted.toolCalls) {
              const prep = preparePendingToolCall(tc, {
                userMessage: req.message,
                assistantText,
              });
              if (!prep) continue;
              const dup = pendingToolCalls.some(
                (p) => p.name === prep.name && p.arguments === prep.arguments
              );
              if (!dup) pendingToolCalls.push(prep);
            }
          }
          const visible = extracted.cleanedText.slice(cleanedDisplayLen);
          cleanedDisplayLen = extracted.cleanedText.length;
          const hideInlineJson =
            bufferingInlineToolJson ||
            mightBeLeakedToolSyntax(assistantText) ||
            (extracted.toolCalls.length > 0 && !visible.trim());
          if (visible && !hideInlineJson) {
            streamedAnyText = true;
            const ev: AgentEvent = { type: 'text', data: { text: visible, threadId } };
            onEvent?.(ev);
            yield ev;
          }
        }
        if (chunk.type === 'tool_calls' && chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            const prep = preparePendingToolCall(tc, {
              userMessage: req.message,
              assistantText,
            });
            if (prep) pendingToolCalls.push(prep);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'error', data: { message: msg } };
      break;
    }

    yield {
      type: 'activity',
      data: { id: thinkId, step: thinkMeta.step, label: thinkMeta.label, status: 'done', threadId },
    };

    const rawAssistantForRecovery = assistantText;
    const finalExtract = extractToolCallsFromText(
      assistantText,
      req.message,
      req.workspaceRoot
    );
    if (finalExtract.toolCalls.length) {
      for (const tc of finalExtract.toolCalls) {
        const prep = preparePendingToolCall(tc, {
          userMessage: req.message,
          assistantText,
        });
        if (!prep) continue;
        const dup = pendingToolCalls.some(
          (p) => p.name === prep.name && p.arguments === prep.arguments
        );
        if (!dup) pendingToolCalls.push(prep);
      }
    }
    assistantText = finalExtract.cleanedText;

    if (pendingToolCalls.length === 0) {
      for (const tc of extractRecoveryToolCalls(
        rawAssistantForRecovery,
        req.message,
        req.workspaceRoot
      )) {
        const prep = preparePendingToolCall(tc, {
          userMessage: req.message,
          assistantText: rawAssistantForRecovery,
        });
        if (!prep) continue;
        const dup = pendingToolCalls.some(
          (p) => p.name === prep.name && p.arguments === prep.arguments
        );
        if (!dup) pendingToolCalls.push(prep);
      }
      if (pendingToolCalls.length) {
        agentLog.info('Recovered tool calls from partial model JSON', {
          tools: pendingToolCalls.map((t) => t.name),
        });
      }
    }

    if (pendingToolCalls.length === 0) {
      const toolJsonFailed =
        !isGreeting && mode === 'agent' && isFailedToolOnlyResponse(assistantText);
      if (toolJsonFailed) {
        if (
          !retriedToolJson &&
          shouldRequireAgentTools(req.message) &&
          ollamaSupportsTools
        ) {
          retriedToolJson = true;
          agentLog.warn('Tool JSON leak — retrying with tool_choice required', {
            model: config.model,
          });
          messages.push({
            role: 'user',
            content:
              'Your last reply leaked tool JSON in chat instead of calling tools. ' +
              'Use the native write_file / read_file / glob tools now. ' +
              'Do not print {"name":"write_file"...} in the message. ' +
              'Call write_file with full file contents for each new file.',
          });
          continue;
        }
        const hint =
          `The model (${config.model}) returned incomplete tool JSON instead of editing files. ` +
          'For Ollama, run `ollama pull qwen2.5-coder` and set **Rubynod › Models › Chat Model** to `qwen2.5-coder`. ' +
          'Then reload the window and retry. Or use **Rubynod: Start AI Service** and check Output → Rubynod.';
        agentLog.warn('No tools ran; leaked tool JSON in model output', {
          assistantPreview: rawAssistantForRecovery.slice(0, 200),
          model: config.model,
        });
        thread.messages.push({ role: 'assistant', content: hint });
        yield { type: 'error', data: { message: hint, threadId } };
        break;
      }
      thread.messages.push({ role: 'assistant', content: assistantText });
      if (mode === 'plan' && assistantText) {
        yield { type: 'plan', data: { content: assistantText, threadId } };
      }
      break;
    }

    if (assistantText.trim()) {
      yield {
        type: 'thought',
        data: { text: assistantText.trim(), threadId },
      };
    }

    thread.messages.push({
      role: 'assistant',
      content: assistantText || `[Calling ${pendingToolCalls.map((t) => t.name).join(', ')}]`,
    });
    messages.push({
      role: 'assistant',
      content: assistantText || `[tool calls]`,
    });

    const toolCtx = { userMessage: req.message, assistantText };
    const validatedCalls: PendingToolCall[] = [];
    const skippedWriteHints: string[] = [];

    for (const tc of pendingToolCalls) {
      const prep = preparePendingToolCall(tc, toolCtx);
      if (prep) {
        validatedCalls.push(prep);
        continue;
      }
      if (tc.name === 'write_file') {
        const hint = buildSkippedWriteFileHint(tc, req.message);
        if (!skippedWriteHints.includes(hint)) skippedWriteHints.push(hint);
      }
    }

    agentLog.info('Executing tools', {
      count: validatedCalls.length,
      skipped: skippedWriteHints.length,
      names: validatedCalls.map((t) => t.name),
    });

    for (const hint of skippedWriteHints) {
      agentLog.warn('Skipped incomplete write_file', hint.slice(0, 200));
      const synthId = `skip-${randomUUID()}`;
      thread.messages.push({
        role: 'tool',
        content: hint,
        toolCallId: synthId,
        name: 'write_file',
      });
      messages.push({
        role: 'tool',
        content: hint,
        toolCallId: synthId,
        name: 'write_file',
      });
    }

    if (validatedCalls.length === 0 && skippedWriteHints.length > 0) {
      continue;
    }

    const dedupedCalls = dedupePendingToolCalls(validatedCalls);
    if (dedupedCalls.length < validatedCalls.length) {
      agentLog.warn('Deduped duplicate tool calls', {
        before: validatedCalls.length,
        after: dedupedCalls.length,
      });
    }

    for (const tc of dedupedCalls) {
      if (thread.cancelled) break;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      const act = describeToolStart(tc.name, parsed);
      yield {
        type: 'activity',
        data: {
          id: tc.id,
          step: act.step,
          label: act.label,
          detail: act.detail,
          status: 'active',
          threadId,
        },
      };
      yield { type: 'tool_start', data: { id: tc.id, name: tc.name, args: parsed, threadId } };

      let result: string;
      try {
        result = await executeTool(tc.name, parsed, {
          mode: thread.mode,
          workspaceRoot: req.workspaceRoot,
          userMessage: req.message,
          writeStatsByPath,
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
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      const ok = !result.startsWith('Error:') && !result.startsWith('Rejected');

      let writtenPath: string | undefined;
      let writtenContents: string | undefined;
      if (ok && tc.name === 'write_file' && typeof parsed.path === 'string') {
        const rel = String(parsed.path).trim();
        const abs = path.join(req.workspaceRoot, rel);
        if (fs.existsSync(abs)) {
          writtenPath = rel;
          writtenContents = fs.readFileSync(abs, 'utf8');
          writeStatsByPath.set(rel, {
            chars: writtenContents.length,
            count: (writeStatsByPath.get(rel)?.count ?? 0) + 1,
          });
        }
      }

      yield {
        type: 'activity',
        data: {
          id: tc.id,
          step: act.step,
          label: act.label,
          detail: describeToolEnd(tc.name, result, ok),
          status: ok ? 'done' : 'error',
          threadId,
        },
      };
      yield {
        type: 'tool_end',
        data: { id: tc.id, name: tc.name, result, threadId, writtenPath, writtenContents },
      };

      const toolMsg: ChatMessage = {
        role: 'tool',
        content: result,
        toolCallId: tc.id,
        name: tc.name,
      };
      thread.messages.push(toolMsg);
      messages.push(toolMsg);
      toolsExecutedThisRun++;
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
