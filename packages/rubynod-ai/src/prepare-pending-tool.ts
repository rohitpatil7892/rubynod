import {
  extractJsonStringField,
  extractSearchReplaceFallback,
  extractWriteFileFallback,
} from './text-tool-calls.js';
import { normalizeToolFilePath } from './sanitize-code.js';
import { extractMentionedFilePaths } from './project-context.js';
import { inferNewServicePath, inferReadFilePath } from './service-path.js';
import { normalizeWriteFileArgs } from './tools.js';

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** First @mentioned file path in the user message. */
export function inferMentionedFilePath(userMessage: string): string | undefined {
  return extractMentionedFilePaths(userMessage)[0];
}

function parseArgsRaw(tc: PendingToolCall): Record<string, unknown> {
  try {
    return JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function tryRepairWriteFileArgs(
  args: Record<string, unknown>,
  assistantText?: string
): Record<string, unknown> | null {
  let normalized = normalizeWriteFileArgs(args);
  if (normalized) {
    return { path: normalized.path, contents: normalized.contents };
  }
  if (!assistantText) return null;
  const fb = extractWriteFileFallback(assistantText);
  if (!fb) return null;
  try {
    const repaired = JSON.parse(fb.arguments) as Record<string, unknown>;
    normalized = normalizeWriteFileArgs(repaired);
    if (normalized) return { path: normalized.path, contents: normalized.contents };
  } catch {
    /* ignore */
  }
  return null;
}

function tryRepairSearchReplaceArgs(
  args: Record<string, unknown>,
  assistantText?: string
): Record<string, unknown> | null {
  const path = typeof args.path === 'string' ? normalizeToolFilePath(args.path) : '';
  const oldStr = args.old_string;
  const newStr = args.new_string;
  if (path && typeof oldStr === 'string' && typeof newStr === 'string') {
    return { path, old_string: oldStr, new_string: newStr, replace_all: args.replace_all };
  }
  if (!assistantText) return null;
  const fb = extractSearchReplaceFallback(assistantText);
  if (!fb) return null;
  try {
    return JSON.parse(fb.arguments) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Drop incomplete Ollama tool_calls; repair from inline JSON in assistant text when possible. */
export function preparePendingToolCall(
  tc: PendingToolCall,
  ctx: { userMessage?: string; assistantText?: string }
): PendingToolCall | null {
  const name = tc.name?.trim();
  if (!name) return null;

  let args = parseArgsRaw(tc);

  if (name === 'write_file') {
    if (typeof args.path !== 'string' || !String(args.path).trim()) {
      const msg = ctx.userMessage ?? '';
      const creatingNew =
        /\b(?:add|create|new)\s+(?:a\s+)?(?:shared\s+)?(?:service|module|client)\b/i.test(msg) ||
        /\b[a-z][a-z0-9-]*-api-client\b/i.test(msg);
      const servicePath = creatingNew ? inferNewServicePath(msg) : undefined;
      if (servicePath) {
        args = { ...args, path: servicePath };
      } else if (!creatingNew) {
        const inferred = inferMentionedFilePath(msg);
        if (inferred) args = { ...args, path: inferred };
      }
    }
    const repaired = tryRepairWriteFileArgs(args, ctx.assistantText);
    if (!repaired) return null;
    return { ...tc, name, arguments: JSON.stringify(repaired) };
  }

  if (name === 'search_replace') {
    const repaired = tryRepairSearchReplaceArgs(args, ctx.assistantText);
    if (!repaired) return null;
    return { ...tc, name, arguments: JSON.stringify(repaired) };
  }

  if (name === 'read_file') {
    let p =
      typeof args.path === 'string' && String(args.path).trim()
        ? normalizeToolFilePath(String(args.path))
        : '';
    if (!p && ctx.assistantText) {
      const fromJson = extractJsonStringField(ctx.assistantText, 'path');
      if (fromJson?.trim()) p = normalizeToolFilePath(fromJson);
    }
    if (!p) {
      const msg = ctx.userMessage ?? '';
      p =
        inferMentionedFilePath(msg) ??
        inferReadFilePath(msg) ??
        '';
    }
    if (!p) return null;
    const out: Record<string, unknown> = { path: p };
    if (typeof args.offset === 'number') out.offset = args.offset;
    if (typeof args.limit === 'number') out.limit = args.limit;
    return { ...tc, name, arguments: JSON.stringify(out) };
  }

  if (!tc.arguments?.trim() || tc.arguments.trim() === '{}') {
    return null;
  }

  return tc;
}

/** Keep one write_file per path (longest contents); one search_replace per path (last). */
export function dedupePendingToolCalls(calls: PendingToolCall[]): PendingToolCall[] {
  const writeByPath = new Map<string, PendingToolCall>();
  const searchByPath = new Map<string, PendingToolCall>();
  const rest: PendingToolCall[] = [];

  for (const tc of calls) {
    if (tc.name === 'write_file') {
      try {
        const args = JSON.parse(tc.arguments) as { path?: string; contents?: string };
        const p = normalizeToolFilePath(String(args.path ?? ''));
        if (!p) {
          rest.push(tc);
          continue;
        }
        const len = String(args.contents ?? '').length;
        const prev = writeByPath.get(p);
        const prevLen = prev
          ? String((JSON.parse(prev.arguments) as { contents?: string }).contents ?? '').length
          : 0;
        if (!prev || len >= prevLen) writeByPath.set(p, tc);
      } catch {
        rest.push(tc);
      }
      continue;
    }
    if (tc.name === 'search_replace') {
      try {
        const args = JSON.parse(tc.arguments) as { path?: string };
        const p = normalizeToolFilePath(String(args.path ?? ''));
        if (p) searchByPath.set(p, tc);
        else rest.push(tc);
      } catch {
        rest.push(tc);
      }
      continue;
    }
    rest.push(tc);
  }

  return [...rest, ...writeByPath.values(), ...searchByPath.values()];
}

export function buildSkippedReadFileHint(userMessage: string): string {
  const path =
    inferMentionedFilePath(userMessage) ??
    inferReadFilePath(userMessage) ??
    inferNewServicePath(userMessage) ??
    'shared/booking-api-client.service.ts';
  return (
    `Error: read_file requires a path (model sent null). ` +
    `Try read_file('${path}'), glob('**/*.service.ts', 'shared'), or list_dir('shared'). ` +
    `Then write_file with full source in contents.`
  );
}

export function buildSkippedWriteFileHint(
  tc: PendingToolCall,
  userMessage: string
): string {
  const args = parseArgsRaw(tc);
  const path =
    (typeof args.path === 'string' && normalizeToolFilePath(args.path)) ||
    inferMentionedFilePath(userMessage) ||
    'the target file';
  return (
    `Error: Incomplete write_file from the model (missing \`contents\`). ` +
    `For ${path}: call read_file('${path}') first, then use search_replace to add your API routes, ` +
    `or write_file with the complete file text in \`contents\` (not path alone). ` +
    `Prefer search_replace for small edits to existing files.`
  );
}
