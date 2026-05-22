import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractMentionedFilePaths } from './project-context.js';
import {
  normalizeToolFilePath,
  stripAssistantChatNoise,
  stripPartialToolJsonLeak,
  unescapeLiteralEscapes,
} from './sanitize-code.js';

/** Tool names Ollama/local models sometimes emit as inline JSON instead of native tool_calls. */
const KNOWN_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'search_replace',
  'glob',
  'grep',
  'list_dir',
  'run_terminal',
  'Shell',
  'inspect_workspace',
  'todo_write',
  'web_search',
  'save_memory',
]);

export interface ParsedTextToolCall {
  id: string;
  name: string;
  arguments: string;
}

function decodeJsUnicodeEscapes(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/** Unwrap double-JSON-encoded write_file contents from small models. */
export function unwrapToolArgContents(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  let s = unescapeLiteralEscapes(decodeJsUnicodeEscapes(raw.trim()));
  if (!s) return raw;

  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      /* fall through */
    }
  }

  if (s.startsWith('{') && (s.includes('import ') || s.includes('require('))) {
    try {
      const inner = JSON.parse(s);
      if (typeof inner === 'string') return inner;
      if (inner && typeof inner === 'object' && 'contents' in inner) {
        return (inner as { contents: unknown }).contents;
      }
    } catch {
      /* Invalid JSON that looks like source — do not strip `{`/`}` (corrupts writes). */
    }
  }

  return s;
}

function normalizeToolArgs(raw: Record<string, unknown>): Record<string, unknown> {
  let args: Record<string, unknown> = raw;

  const nested = raw.parameters ?? raw.args;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    args = nested as Record<string, unknown>;
  } else if (typeof nested === 'string') {
    try {
      args = JSON.parse(nested) as Record<string, unknown>;
    } catch {
      args = raw;
    }
  }

  for (const key of ['old_string', 'new_string', 'path', 'pattern', 'command']) {
    if (typeof args[key] === 'string') {
      let v = decodeJsUnicodeEscapes(String(args[key]));
      v = String(unwrapToolArgContents(v));
      args = { ...args, [key]: v };
    }
  }

  if (typeof args.contents === 'string') {
    args = { ...args, contents: unwrapToolArgContents(args.contents) };
  }
  if (typeof args.content === 'string' && args.contents === undefined) {
    args = { ...args, contents: unwrapToolArgContents(args.content) };
  }

  return args;
}

function parseToolObject(obj: Record<string, unknown>): ParsedTextToolCall | null {
  const nameRaw = obj.name ?? obj.function ?? obj.tool;
  if (typeof nameRaw !== 'string' || !KNOWN_TOOL_NAMES.has(nameRaw)) return null;

  const args = normalizeToolArgs(obj);
  if (nameRaw === 'write_file' && typeof args.path === 'string') {
    const c = args.contents ?? args.content ?? args.body ?? args.code;
    if (typeof c !== 'string' || !c.trim()) return null;
    args.contents = c;
  }

  if (nameRaw === 'search_replace') {
    if (typeof args.path !== 'string' || !args.path.trim()) return null;
    if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') return null;
  }

  return {
    id: `txt-${randomUUID()}`,
    name: nameRaw,
    arguments: JSON.stringify(args),
  };
}

/** Ollama often emits invalid escapes like \\u27\\u39 instead of \\u0027 for quotes. */
function repairMalformedToolJson(jsonText: string): string {
  return jsonText
    .replace(/\\u27\\u39/g, "'")
    .replace(/\\u27'9/g, "'")
    .replace(/\\u0027/g, "'")
    .replace(/\\u0039/g, "'");
}

/** Fallback when JSON.parse fails: extract write_file path + contents from broken inline JSON. */
export function extractWriteFileFallback(text: string): ParsedTextToolCall | null {
  const nameMatch = /"name"\s*:\s*"write_file"/.exec(text);
  if (!nameMatch) return null;

  const pathMatch = /"path"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(text);
  if (!pathMatch) return null;

  const contentsKey = /"contents"\s*:\s*"/.exec(text);
  if (!contentsKey) return null;

  const start = contentsKey.index + contentsKey[0].length;
  let i = start;
  let out = '';
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (next === 't') {
        out += '\t';
        i += 2;
        continue;
      }
      if (next === 'r') {
        out += '\r';
        i += 2;
        continue;
      }
      if (next === '"') {
        out += '"';
        i += 2;
        continue;
      }
      if (next === '\\') {
        out += '\\';
        i += 2;
        continue;
      }
      if (next === 'u' && i + 5 < text.length) {
        const hex = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      out += next;
      i += 2;
      continue;
    }
    if (ch === '"') {
      const rest = text.slice(i);
      if (/^"\s*\}\s*\}\s*$/.test(rest) || /^"\s*\}\s*$/.test(rest)) break;
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }

  let contents = String(unwrapToolArgContents(out)).trim();
  if (!contents) return null;
  if (
    (contents.startsWith('"') && contents.includes('import ')) ||
    (contents.startsWith("'") && contents.includes('import '))
  ) {
    contents = contents.replace(/^["']+/, '').replace(/["']+$/, '');
  }

  return {
    id: `txt-${randomUUID()}`,
    name: 'write_file',
    arguments: JSON.stringify({ path: pathMatch[1]!.replace(/\\"/g, '"'), contents }),
  };
}

/** Try to parse a single JSON object substring as a tool invocation. */
function tryParseToolJson(jsonText: string): ParsedTextToolCall | null {
  const repaired = repairMalformedToolJson(jsonText);
  try {
    const obj = JSON.parse(repaired) as Record<string, unknown>;
    return parseToolObject(obj);
  } catch {
    if (/"name"\s*:\s*"write_file"/.test(jsonText)) {
      return extractWriteFileFallback(repaired);
    }
    if (/"name"\s*:\s*"search_replace"/.test(jsonText)) {
      return extractSearchReplaceFallback(repaired);
    }
    return null;
  }
}

/** Fallback parser for broken search_replace inline JSON. */
export function extractSearchReplaceFallback(text: string): ParsedTextToolCall | null {
  if (!/"name"\s*:\s*"search_replace"/.test(text)) return null;
  const path = /"path"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(text)?.[1]?.replace(/\\"/g, '"');
  const oldStr = extractJsonStringField(text, 'old_string');
  const newStr = extractJsonStringField(text, 'new_string');
  if (!path || oldStr === null || newStr === null) return null;
  return {
    id: `txt-${randomUUID()}`,
    name: 'search_replace',
    arguments: JSON.stringify({
      path,
      old_string: oldStr,
      new_string: newStr,
    }),
  };
}

export function extractJsonStringField(text: string, field: string): string | null {
  const re = new RegExp(`"${field}"\\s*:\\s*"`);
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index + m[0].length;
  let out = '';
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (next === '"') {
        out += '"';
        i += 2;
        continue;
      }
      if (next === 'u' && i + 5 < text.length) {
        const hex = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      out += next;
      i += 2;
      continue;
    }
    if (ch === '"') {
      const rest = text.slice(i);
      if (/^"\s*,/.test(rest)) return out;
      if (/^"\s*\}\s*/.test(rest)) return out;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Balanced `(...)` slice starting at index of `(`. */
function findBalancedParenCall(text: string, openParenIdx: number): { inner: string; end: number } | null {
  if (text[openParenIdx] !== '(') return null;
  let depth = 0;
  let inStr = false;
  let strQuote = '';
  let esc = false;
  for (let j = openParenIdx; j < text.length; j++) {
    const ch = text[j]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === strQuote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      strQuote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return { inner: text.slice(openParenIdx + 1, j), end: j + 1 };
      }
    }
  }
  return null;
}

/**
 * Llama / Ollama sometimes emit tool calls as `<|python_tag|>write_file(contents="...", "path")`
 * after a real tool already ran. Strip from chat; do not execute (avoids duplicate/broken writes).
 */
function findLeakedPythonTagSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re =
    /<\|python_tag\|>\s*(write_file|search_replace|read_file|glob|grep|run_terminal|Shell)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const balanced = findBalancedParenCall(text, openParen);
    if (balanced) spans.push({ start: m.index, end: balanced.end });
  }
  return spans;
}

/** Bare `write_file(contents="...")` without python_tag — common leak after tools. */
function findLeakedBareToolCallSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re = /\b(write_file|search_replace)\s*\(\s*contents\s*=/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const openParen = text.indexOf('(', m.index);
    if (openParen < 0) continue;
    const balanced = findBalancedParenCall(text, openParen);
    if (balanced) spans.push({ start: m.index, end: balanced.end });
  }
  return spans;
}

function mergeSpans(spans: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (!spans.length) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function removeSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  if (!spans.length) return text;
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  let out = text;
  for (const sp of sorted) {
    out = out.slice(0, sp.start) + out.slice(sp.end);
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function findBalancedJsonObjects(text: string): Array<{ start: number; end: number; json: string }> {
  const out: Array<{ start: number; end: number; json: string }> = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < text.length; j++) {
      const ch = text[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          out.push({ start, end: j + 1, json: text.slice(start, j + 1) });
          i = j + 1;
          break;
        }
      }
      if (j === text.length - 1) i = text.length;
    }
    if (depth !== 0) i = start + 1;
  }
  return out;
}

/** Salvage tools when Ollama only streamed partial `{"name": "read_file"...`. */
export function extractRecoveryToolCalls(
  assistantText: string,
  userMessage: string,
  workspaceRoot?: string
): ParsedTextToolCall[] {
  const out: ParsedTextToolCall[] = [];

  if (/"name"\s*:\s*"read_file"/.test(assistantText)) {
    const p =
      extractJsonStringField(assistantText, 'path') ?? extractMentionedFilePaths(userMessage)[0];
    if (p) {
      out.push({
        id: `txt-${randomUUID()}`,
        name: 'read_file',
        arguments: JSON.stringify({ path: normalizeToolFilePath(p) }),
      });
    }
  }

  const writeFb = extractWriteFileFallback(assistantText);
  if (writeFb) out.push(writeFb);

  if (/"name"\s*:\s*"search_replace"/.test(assistantText)) {
    const p =
      extractJsonStringField(assistantText, 'path') ?? extractMentionedFilePaths(userMessage)[0];
    const oldStr = extractJsonStringField(assistantText, 'old_string');
    const newStr = extractJsonStringField(assistantText, 'new_string');
    if (p && oldStr !== null && newStr !== null) {
      out.push({
        id: `txt-${randomUUID()}`,
        name: 'search_replace',
        arguments: JSON.stringify({
          path: normalizeToolFilePath(p),
          old_string: oldStr,
          new_string: newStr,
        }),
      });
    }
  }

  if (workspaceRoot && /\\n|literal\s+\\n/i.test(userMessage)) {
    const rel = extractMentionedFilePaths(userMessage)[0];
    if (rel) {
      const abs = path.join(workspaceRoot, rel);
      if (fs.existsSync(abs)) {
        const raw = fs.readFileSync(abs, 'utf8');
        if (/\\n/.test(raw)) {
          const fixed = unescapeLiteralEscapes(raw);
          if (fixed !== raw && fixed.includes('\n')) {
            out.push({
              id: `txt-${randomUUID()}`,
              name: 'write_file',
              arguments: JSON.stringify({
                path: normalizeToolFilePath(rel),
                contents: fixed,
              }),
            });
          }
        }
      }
    }
  }

  return out;
}

/**
 * Local models (Ollama) often stream tool calls as JSON text instead of API tool_calls.
 * Extract them and remove from visible assistant text.
 */
export function extractToolCallsFromText(
  text: string,
  userMessage?: string,
  workspaceRoot?: string
): {
  cleanedText: string;
  toolCalls: ParsedTextToolCall[];
} {
  const toolCalls: ParsedTextToolCall[] = [];
  const spans: Array<{ start: number; end: number }> = [];

  for (const block of findBalancedJsonObjects(text)) {
    const parsed = tryParseToolJson(block.json);
    if (parsed) {
      toolCalls.push(parsed);
      spans.push({ start: block.start, end: block.end });
    }
  }

  let cleanedText = text;
  if (spans.length) {
    cleanedText = removeSpans(cleanedText, spans);
  }

  const leakSpans = mergeSpans([
    ...findLeakedPythonTagSpans(cleanedText),
    ...findLeakedBareToolCallSpans(cleanedText),
    ...findMalformedSourceJsonSpans(cleanedText),
  ]);
  if (leakSpans.length) {
    cleanedText = removeSpans(cleanedText, leakSpans);
  }

  cleanedText = stripPartialToolJsonLeak(stripAssistantChatNoise(cleanedText));
  if (/^json\s*$/im.test(cleanedText)) cleanedText = '';

  if (!toolCalls.length && userMessage) {
    for (const r of extractRecoveryToolCalls(text, userMessage, workspaceRoot)) {
      toolCalls.push(r);
    }
  }

  if (!toolCalls.length && !leakSpans.length && !spans.length && cleanedText === text) {
    return { cleanedText: text, toolCalls: [] };
  }

  return { cleanedText, toolCalls };
}

/** `{"import ...` blobs models emit as text (not valid tool JSON). */
function findMalformedSourceJsonSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re = /\{\s*"(?:import|export|const|let|require)\s/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (/"name"\s*:\s*"(?:write_file|search_replace)"/.test(text.slice(m.index, m.index + 200))) {
      continue;
    }
    const tail = text.slice(m.index);
    let end = m.index + tail.length;
    const markers = [
      /\n(?:Created|Updated) (?:new |existing )?file /i,
      /\n## Context:/i,
      /\nAdded to package\.json/i,
      /\nPatched /i,
    ];
    for (const marker of markers) {
      const hit = marker.exec(tail);
      if (hit && hit.index > 0) end = Math.min(end, m.index + hit.index);
    }
    const exportEnd = tail.match(/\nexport\s+default\s+[^;\n]+;?/);
    if (exportEnd) {
      end = Math.min(end, m.index + exportEnd.index! + exportEnd[0].length);
    } else {
      const balanced = findBalancedJsonObjects(tail);
      if (balanced[0]) end = Math.min(end, m.index + balanced[0].end);
    }
    if (end > m.index) spans.push({ start: m.index, end });
  }
  return spans;
}

/** True if chunk looks like inline tool JSON (do not show in chat). */
export function looksLikeInlineToolJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{')) return false;
  return /"name"\s*:\s*"(?:write_file|read_file|search_replace|run_terminal|glob|grep|list_dir|inspect_workspace|Shell)"/.test(
    t
  );
}

/** Detect partial streamed Ollama tool JSON before the tool name is complete. */
export function mightBeInlineToolJson(text: string): boolean {
  const t = text.trimStart();
  if (!t.startsWith('{')) return false;
  if (looksLikeInlineToolJson(text)) return true;
  return /^\{\s*"name"\s*:\s*"?/.test(t);
}

/** Llama-style `<|python_tag|>write_file(...)` or bare `write_file(contents=...)` leaks. */
export function mightBeLeakedToolSyntax(text: string): boolean {
  const t = text.trim();
  if (/^json\s*$/i.test(t)) return true;
  if (/^```json\s*$/i.test(t)) return true;
  if (/```json/i.test(text) && /\{\s*"name/i.test(text)) return true;
  if (mightBeInlineToolJson(text)) return true;
  if (/<\|python_tag\|>/i.test(text)) return true;
  if (/\bwrite_file\s*\(\s*contents\s*=/i.test(text)) return true;
  if (/\bsearch_replace\s*\(\s*/i.test(text)) return true;
  if (/^\s*\{\s*"(?:import|export|const|let|require)\s/m.test(text)) return true;
  if (/^\s*\{\s*"name"\s*:\s*"?/m.test(text)) return true;
  if (/```json\s*```/i.test(text)) return true;
  if (/## Context: file —/i.test(text)) return true;
  if (/"dependencies"\s*:\s*\{/.test(text) && /"name"\s*:\s*"/.test(text) && !/"name"\s*:\s*"write_file"/.test(text)) {
    return true;
  }
  if (/(?:Updated|Created) (?:new |existing )?file /i.test(text)) return true;
  if (/^Added\s+/im.test(text)) return true;
  const tail = text.slice(-120);
  if (/<\|python_tag\|?\s*$/i.test(tail)) return true;
  if (/\bwrite_file\s*\(\s*contents\s*=\s*"[^"]*$/i.test(text)) return true;
  return false;
}
