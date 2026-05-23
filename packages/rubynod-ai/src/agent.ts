import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodebaseIndexer } from '@rubynod/index';
import { McpHub } from '@rubynod/mcp';
import { buildSystemPrompt } from './rules.js';
import {
  buildFocusedFileDirective,
  buildNpmInstallDirective,
  extractMentionedFilePaths,
  hasExplicitFileMention,
  inspectWorkspaceSetup,
  isNpmInstallIntent,
  shouldAttachWorkspaceSetup,
  shouldRequireAgentTools,
} from './project-context.js';
import {
  isFailedToolOnlyResponse,
  looksLikeTutorialOrToolLeak,
  stripAssistantChatNoise,
} from './sanitize-code.js';
import { getCachedContextPack, setCachedContextPack } from './context-cache.js';
import { buildContextBundle } from './context-bundle.js';
import {
  buildScratchpadSummary,
  recordFileRead,
  recordFileEdit,
  recordCommand,
  recordError,
} from './agent-scratchpad.js';
import { workspaceSummaryAsContext } from './workspace-summary.js';
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
  buildSkippedReadFileHint,
  buildSkippedWriteFileHint,
  dedupePendingToolCalls,
  preparePendingToolCall,
  type PendingToolCall,
} from './prepare-pending-tool.js';
import { inferNewServicePath } from './service-path.js';
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

  const autoContextMode: 'coding' | 'minimal' | 'off' =
    cs?.autoContextMode ?? (cs?.autoIndexContext !== false ? 'coding' : 'off');

  // Build getBridgeActiveContext callback that fetches active file + diagnostics from IDE
  const getBridgeActiveContext = bridge
    ? async () => {
        const active: import('./types.js').ContextAttachment[] = [];
        try {
          const editors = await bridge.getOpenEditors?.();
          const firstFile = typeof editors === 'string' ? editors.split('\n')[0]?.trim() : '';
          if (firstFile) {
            const content = await bridge.readFile(firstFile, 1, 200).catch(() => '');
            if (content && !content.startsWith('Error:')) {
              active.push({ type: 'file', label: `Active: ${firstFile}`, path: firstFile, content: `## Active file: ${firstFile}\n\`\`\`\n${content}\n\`\`\`` });
            }
          }
          const lints = await bridge.readLints?.([]);
          if (lints && lints !== '(no diagnostics)' && !lints.startsWith('(lint')) {
            active.push({ type: 'diagnostics', label: 'Diagnostics', content: `## Problems\n${lints.split('\n').slice(0, 30).join('\n')}` });
          }
        } catch {
          // Bridge may not have all methods; skip silently
        }
        return active;
      }
    : undefined;

  const contextAttachments = await buildContextBundle({
    message: req.message,
    manualAttachments: req.context ?? [],
    workspaceRoot: req.workspaceRoot,
    indexer,
    autoContextMode: autoContextMode as 'coding' | 'minimal' | 'off',
    maxAutoContextChunks: cs?.maxAutoContextChunks ?? 8,
    maxAutoContextChars: cs?.maxAutoContextChars ?? 24_000,
    contextCacheTtlSec: cs?.contextCacheTtlSec ?? 45,
    getBridgeActiveContext,
    model: req.model,
  });

  if (mode === 'agent' && shouldAttachWorkspaceSetup(req.message)) {
    contextAttachments.unshift({
      type: 'rules',
      label: 'Workspace setup',
      content: inspectWorkspaceSetup(req.workspaceRoot),
    });
  }
  // Attach workspace summary (framework, test runner, etc.) as low-priority context
  const wsSummaryCtx = workspaceSummaryAsContext(req.workspaceRoot);
  if (wsSummaryCtx && !contextAttachments.some((a) => a.label === 'Workspace stack')) {
    contextAttachments.push(wsSummaryCtx);
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
      if (mode === 'agent') {
        const err = formatOllamaNoToolsModelError(config.model);
        yield { type: 'error', data: { message: err } };
        yield { type: 'done', data: { threadId } };
        return;
      }
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
  const focusedFileHint = buildFocusedFileDirective(req.message, req.workspaceRoot);
  if (focusedFileHint) {
    system += `\n\n${focusedFileHint}`;
  } else if (mode === 'agent' && isNpmInstallIntent(req.message)) {
    system += `\n\n${buildNpmInstallDirective(req.workspaceRoot)}`;
  }
  if (isGreeting) {
    system +=
      '\n\nThe user sent a brief greeting only. Reply in one or two friendly sentences. Do not call read_file or any other tools.';
  }
  // Inject per-thread scratchpad summary to prevent re-reads and re-installs
  const scratchpadSummary = buildScratchpadSummary(thread.id);
  if (scratchpadSummary) {
    system += `\n\n${scratchpadSummary}`;
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...thread.messages,
  ];

  const maxTurns = cs?.maxAgentTurns ?? 25;
  /** Per user message: track writes to block incremental tiny overwrites. */
  const writeStatsByPath = new Map<string, { chars: number; count: number }>();
  let toolsExecutedThisRun = 0;
  let fileMutatingToolsRan = 0;
  let retriedToolJson = false;
  let tutorialNudges = 0;
  const maxTutorialNudges = 3;
  const touchedPaths = new Set<string>();
  let verifyDone = false;

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
      const needsTools =
        !isGreeting && mode === 'agent' && shouldRequireAgentTools(req.message);
      const tutorialOrSteps = needsTools && looksLikeTutorialOrToolLeak(rawAssistantForRecovery);
      const toolJsonFailed = needsTools && isFailedToolOnlyResponse(assistantText);
      const mustUseTools = needsTools && (tutorialOrSteps || toolJsonFailed);
      const targetPath = inferNewServicePath(req.message);

      if (mustUseTools) {
        const inspectedOnly =
          needsTools && toolsExecutedThisRun > 0 && fileMutatingToolsRan === 0;

        if (inspectedOnly && tutorialNudges < maxTutorialNudges && ollamaSupportsTools) {
          tutorialNudges++;
          agentLog.warn('Tutorial after inspect-only tools — nudging write_file', {
            model: config.model,
            toolsExecutedThisRun,
            targetPath,
            tutorialNudges,
          });
          if (rawAssistantForRecovery.trim()) {
            messages.push({
              role: 'assistant',
              content: rawAssistantForRecovery.slice(0, 8000),
            });
          }
          const pathHint = targetPath ?? 'shared/<service>.service.ts';
          messages.push({
            role: 'user',
            content:
              `Stop explaining Nx steps in chat. You already ran inspect tools.\n` +
              `Next: glob("**/*.service.ts") or list_dir("libs") / list_dir("shared"), ` +
              `read_file one existing service as a template, then ` +
              `write_file("${pathHint}", contents=...) with FULL TypeScript (imports, class, exports). ` +
              `No placeholders.`,
          });
          continue;
        }

        if (!retriedToolJson && toolsExecutedThisRun === 0 && ollamaSupportsTools) {
          retriedToolJson = true;
          agentLog.warn('Model replied with tutorial/steps but no tools — retrying', {
            model: config.model,
            tutorialOrSteps,
            toolJsonFailed,
          });
          if (rawAssistantForRecovery.trim()) {
            messages.push({
              role: 'assistant',
              content: rawAssistantForRecovery.slice(0, 8000),
            });
          }
          const mentioned = extractMentionedFilePaths(req.message);
          const pathHint = mentioned[0] ?? targetPath ?? 'shared/booking-api-client.service.ts';
          const retryContent = mentioned.length
            ? `Do not paste code or tutorials in chat. Edit the @mentioned file with tools now:\n` +
              `1) read_file('${mentioned[0]}')\n` +
              `2) search_replace on '${mentioned[0]}' with the requested changes\n` +
              'Reply in one short sentence after the file is updated.'
            : 'Do not explain steps or Nx commands in chat. Call tools now:\n' +
              '1) list_dir or glob to find shared/libs layout\n' +
              '2) read_file on an existing *.service.ts if present\n' +
              `3) write_file("${pathHint}", contents=...) with complete TypeScript\n` +
              'No placeholders. Use native tool calls only.';
          messages.push({ role: 'user', content: retryContent });
          continue;
        }

        const hint = inspectedOnly
          ? `The model (${config.model}) explored the repo (${toolsExecutedThisRun} tool(s)) but did not create ` +
            `${targetPath ?? 'the service file'}. Try \`qwen2.5-coder:7b\`, reload, and ask again with: ` +
            `"Use write_file only — no steps in chat."`
          : `The model (${config.model}) explained what to do but did not call any tools (no files changed). ` +
            'Try `qwen2.5-coder` (7b or latest tag), reload the window, and ask again. ' +
            'If it keeps happening, check Output → Rubynod for Ollama errors or slow generation on :14b.';
        agentLog.warn('Agent stopped: tutorial without completing file task', {
          assistantPreview: rawAssistantForRecovery.slice(0, 200),
          model: config.model,
          toolsExecutedThisRun,
          fileMutatingToolsRan,
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

    const skipThoughtDump =
      pendingToolCalls.length > 0 &&
      (isFailedToolOnlyResponse(assistantText) || looksLikeTutorialOrToolLeak(assistantText));
    if (assistantText.trim() && !skipThoughtDump) {
      const thoughtText = stripAssistantChatNoise(assistantText).trim();
      if (thoughtText) {
        yield {
          type: 'thought',
          data: { text: thoughtText, threadId },
        };
      }
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
    const skippedToolHints: Array<{ name: string; content: string }> = [];

    for (const tc of pendingToolCalls) {
      const prep = preparePendingToolCall(tc, toolCtx);
      if (prep) {
        validatedCalls.push(prep);
        continue;
      }
      if (tc.name === 'write_file') {
        const hint = buildSkippedWriteFileHint(tc, req.message);
        if (!skippedToolHints.some((h) => h.content === hint)) {
          skippedToolHints.push({ name: 'write_file', content: hint });
        }
      }
      if (tc.name === 'read_file') {
        const hint = buildSkippedReadFileHint(req.message);
        if (!skippedToolHints.some((h) => h.content === hint)) {
          skippedToolHints.push({ name: 'read_file', content: hint });
        }
      }
    }

    agentLog.info('Executing tools', {
      count: validatedCalls.length,
      skipped: skippedToolHints.length,
      names: validatedCalls.map((t) => t.name),
    });

    for (const { name, content } of skippedToolHints) {
      agentLog.warn('Skipped incomplete tool', { name, preview: content.slice(0, 200) });
      const synthId = `skip-${randomUUID()}`;
      thread.messages.push({
        role: 'tool',
        content,
        toolCallId: synthId,
        name,
      });
      messages.push({
        role: 'tool',
        content,
        toolCallId: synthId,
        name,
      });
    }

    if (validatedCalls.length === 0 && skippedToolHints.length > 0) {
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
            const oldLines = (oldC ?? '').split('\n');
            const newLines = (newC ?? '').split('\n');
            const added = newLines.filter((l, i) => l !== oldLines[i] && i >= oldLines.length - 1 || !oldLines.includes(l)).length;
            const removed = oldLines.filter((l, i) => l !== newLines[i] && i >= newLines.length - 1 || !newLines.includes(l)).length;
            const ev: AgentEvent = {
              type: 'diff',
              data: { file, oldContent: oldC, newContent: newC, threadId, added, removed },
            };
            onEvent?.(ev);
          },
        });
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      const ok = !result.startsWith('Error:') && !result.startsWith('Rejected');

      // Record tool events into per-thread scratchpad
      if (ok) {
        if ((tc.name === 'read_file' || tc.name === 'readFile') && typeof parsed.path === 'string') {
          recordFileRead(thread.id, String(parsed.path));
        } else if ((tc.name === 'write_file' || tc.name === 'search_replace') && typeof parsed.path === 'string') {
          recordFileEdit(thread.id, String(parsed.path));
        } else if (tc.name === 'run_terminal' && typeof parsed.command === 'string') {
          recordCommand(thread.id, String(parsed.command));
        }
      } else if (result.startsWith('Error:')) {
        recordError(thread.id, result.slice(0, 200));
      }

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
      if (ok && (tc.name === 'write_file' || tc.name === 'search_replace')) {
        fileMutatingToolsRan++;
        if (typeof parsed.path === 'string') {
          touchedPaths.add(String(parsed.path).trim());
        }
      }
    }

    // Post-edit verify: after file writes, auto-run read_lints once to catch errors
    if (!verifyDone && touchedPaths.size > 0 && fileMutatingToolsRan > 0 && pendingToolCalls.length === 0) {
      verifyDone = true;
      const paths = [...touchedPaths];
      const lintId = `verify-${randomUUID()}`;
      yield { type: 'activity', data: { id: lintId, step: 'verify', label: 'Checking for lint errors…', status: 'active', threadId } };
      let lintResult: string;
      try {
        lintResult = bridge
          ? await bridge.readLints(paths)
          : `(lints unavailable without IDE bridge)`;
      } catch {
        lintResult = '(lint check failed)';
      }
      yield { type: 'activity', data: { id: lintId, step: 'verify', label: 'Lint check done', status: 'done', threadId } };

      const hasErrors = lintResult && lintResult !== '(no diagnostics)' && !lintResult.startsWith('(lint');
      if (hasErrors) {
        const lintMsg: ChatMessage = { role: 'tool', content: lintResult, toolCallId: lintId, name: 'read_lints' };
        thread.messages.push(lintMsg);
        messages.push(lintMsg);
        messages.push({
          role: 'user',
          content: `The files you edited have lint errors:\n\n${lintResult}\n\nFix them now using search_replace or write_file.`,
        });
        agentLog.info('Post-edit lint errors found — auto-repair turn triggered', { paths, preview: lintResult.slice(0, 300) });
        continue;
      }
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
