import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentMode, IdeBridge } from './types.js';
import { CodebaseIndexer } from '@rubynod/index';
import type { McpHub } from '@rubynod/mcp';
import { webSearch } from './web-search.js';
import { appendMemory } from './memories.js';
import { resolveWritePath } from './write-path.js';
import {
  looksLikePlaceholderStub,
  looksLikeTutorialOrToolLeak,
  normalizeToolFilePath,
  sanitizeFileContents,
  validateDestructiveOverwrite,
  validateWriteContents,
} from './sanitize-code.js';
import {
  hasExplicitFileMention,
  inspectWorkspaceSetup,
  isWritePathAllowedForMessage,
} from './project-context.js';
import { inferReadFilePath } from './service-path.js';
import { prepareJsonWrite } from './json-write.js';
import { ensurePackageJsonDependencies } from './package-deps.js';
import { toolLog } from './logger.js';

const WRITE_TOOLS = new Set(['write_file', 'search_replace', 'Shell', 'run_terminal']);
const READ_ONLY_MODES: AgentMode[] = ['plan', 'ask'];

/** Some models send `content` / `body` instead of `contents`. */
export function normalizeWriteFileArgs(
  args: Record<string, unknown>
): { path: string; contents: string } | null {
  const p = args.path;
  if (typeof p !== 'string' || !p.trim()) return null;
  const raw =
    args.contents ??
    args.content ??
    args.body ??
    args.text ??
    args.code ??
    args.data;
  if (typeof raw !== 'string') return null;
  return { path: normalizeToolFilePath(p), contents: raw };
}

export function getToolDefinitions(
  mode: AgentMode,
  mcpHub?: McpHub,
  opts?: { webSearch?: boolean }
) {
  const tools = [
    {
      type: 'function' as const,
      function: {
        name: 'read_file',
        description: 'Read file contents with optional line range',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            offset: { type: 'number' },
            limit: { type: 'number' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'write_file',
        description:
          'Write or create a file with the FULL file contents in `contents`. The `contents` argument must be exactly what should be on disk — do not describe different code in chat. Before creating a new file, use read_file/glob/inspect_workspace — if the file exists, read it and prefer search_replace unless replacing entirely. When adding npm imports (mysql, express, etc.), also update package.json dependencies in the same turn. Use short paths (server.js, package.json). Never slugify the user message as the filename.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Relative path from workspace root (e.g. server.js, src/routes/users.ts). Not a sentence or prompt text.',
            },
            contents: { type: 'string', description: 'Complete file text to write' },
          },
          required: ['path', 'contents'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'search_replace',
        description: 'Replace text in a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'glob',
        description: 'Find files by glob pattern',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' }, cwd: { type: 'string' } },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'grep',
        description: 'Search file contents with regex',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' }, path: { type: 'string' } },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'inspect_workspace',
        description:
          'Snapshot of workspace setup: package.json, node_modules, existing server entry files, suggested run command. Call this before creating server.js or package.json.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_dir',
        description: 'List directory contents',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'run_terminal',
        description:
          'Run a shell command in the workspace. Tell the user the command in chat first; they must Approve in the IDE (unless auto-approve). Use after setup exists (package.json, server file).',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            block_until_ms: { type: 'number' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'read_lints',
        description: 'Read IDE diagnostics/linter errors',
        parameters: {
          type: 'object',
          properties: { paths: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'codebase_search',
        description: 'Semantic search over indexed codebase (@codebase)',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'number' } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'todo_write',
        description: 'Update structured task list for long jobs',
        parameters: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  content: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
                },
              },
            },
            merge: { type: 'boolean' },
          },
          required: ['todos'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'switch_mode',
        description: 'Switch agent mode: agent, plan, ask, debug',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['agent', 'plan', 'ask', 'debug'] },
            explanation: { type: 'string' },
          },
          required: ['mode'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'save_memory',
        description: 'Save a persistent fact to .rubynod/memories.json',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    },
  ];

  type ToolDef = (typeof tools)[number];
  const extraTools: ToolDef[] = [];
  if (opts?.webSearch || process.env.RUBYNOD_WEB_SEARCH === '1') {
    extraTools.push({
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for up-to-date information (DuckDuckGo)',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    } as ToolDef);
  }

  const all = [...tools, ...extraTools];

  if (READ_ONLY_MODES.includes(mode)) {
    return all.filter((t) => !WRITE_TOOLS.has(t.function.name));
  }

  const mcpTools = mcpHub?.getOpenAiTools() ?? [];
  return [...all, ...mcpTools];
}

function localGlob(workspaceRoot: string, pattern: string, cwd?: string): string[] {
  const base = cwd ? path.resolve(workspaceRoot, cwd) : workspaceRoot;
  const results: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(base, full).replace(/\\/g, '/');
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        walk(full);
      } else if (e.isFile()) {
        const simple = pattern.replace(/\*\*/g, '').replace(/\*/g, '.*');
        if (new RegExp(simple).test(rel) || rel.includes(pattern.replace(/\*\*/g, ''))) {
          results.push(rel);
        }
      }
    }
  };
  walk(base);
  return results.slice(0, 200);
}

function localGrep(workspaceRoot: string, pattern: string, searchPath?: string): string {
  try {
    const target = searchPath ? path.resolve(workspaceRoot, searchPath) : workspaceRoot;
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `rg --no-heading -n -m 50 "${pattern.replace(/"/g, '\\"')}" "${target.replace(/"/g, '\\"')}" 2>nul`
      : `rg --no-heading -n -m 50 ${JSON.stringify(pattern)} ${JSON.stringify(target)} 2>/dev/null || true`;
    const out = execSync(cmd, {
      encoding: 'utf8',
      maxBuffer: 512_000,
      ...(isWin ? { shell: process.env.COMSPEC ?? 'cmd.exe' } : {}),
    });
    return out?.trim() || '(no matches)';
  } catch {
    return '(grep unavailable — install ripgrep: https://github.com/BurntSushi/ripgrep/releases)';
  }
}

function toolError(err: unknown): string {
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    mode: AgentMode;
    workspaceRoot: string;
    userMessage?: string;
    writeStatsByPath?: Map<string, { chars: number; count: number }>;
    bridge?: IdeBridge;
    indexer?: CodebaseIndexer;
    mcpHub?: McpHub;
    onModeSwitch?: (mode: AgentMode) => void;
    onDiff?: (file: string, oldContent: string, newContent: string) => void;
  }
): Promise<string> {
  try {
    return await executeToolInner(name, args, ctx);
  } catch (err) {
    return toolError(err);
  }
}

async function executeToolInner(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    mode: AgentMode;
    workspaceRoot: string;
    userMessage?: string;
    writeStatsByPath?: Map<string, { chars: number; count: number }>;
    bridge?: IdeBridge;
    indexer?: CodebaseIndexer;
    mcpHub?: McpHub;
    onModeSwitch?: (mode: AgentMode) => void;
    onDiff?: (file: string, oldContent: string, newContent: string) => void;
  }
): Promise<string> {
  if (READ_ONLY_MODES.includes(ctx.mode) && WRITE_TOOLS.has(name)) {
    return `Error: Tool ${name} is disabled in ${ctx.mode} mode.`;
  }

  toolLog.info(`execute ${name}`, {
    path: args.path,
    pattern: args.pattern,
    command: typeof args.command === 'string' ? String(args.command).slice(0, 80) : undefined,
  });

  const bridge = ctx.bridge;
  const ws = ctx.workspaceRoot;

  if (name.startsWith('mcp_') && ctx.mcpHub) {
    return ctx.mcpHub.callTool(name, args);
  }

  switch (name) {
    case 'read_file': {
      let p =
        typeof args.path === 'string' && String(args.path).trim()
          ? normalizeToolFilePath(String(args.path))
          : '';
      if (!p && ctx.userMessage) {
        p = inferReadFilePath(ctx.userMessage) ?? '';
      }
      if (!p) {
        return (
          'Error: read_file requires path (model sent null or empty). ' +
          'Use a real path such as shared/booking-api-client.service.ts or package.json.'
        );
      }
      if (bridge) {
        return bridge.readFile(p, args.offset as number | undefined, args.limit as number | undefined);
      }
      const abs = path.resolve(ws, p);
      if (!fs.existsSync(abs)) return `Error: File not found: ${p}`;
      const content = fs.readFileSync(abs, 'utf8');
      const lines = content.split('\n');
      const start = ((args.offset as number) ?? 1) - 1;
      const end = args.limit ? start + (args.limit as number) : lines.length;
      return lines.slice(start, end).map((l, i) => `${start + i + 1}|${l}`).join('\n');
    }
    case 'write_file': {
      const normalized = normalizeWriteFileArgs(args);
      if (!normalized) {
        const p =
          typeof args.path === 'string' && args.path.trim()
            ? normalizeToolFilePath(args.path)
            : 'the file';
        const hasPathOnly =
          typeof args.path === 'string' &&
          args.path.trim() &&
          args.contents === undefined &&
          args.content === undefined;
        if (hasPathOnly) {
          return (
            `Error: write_file for ${p} had path only — Ollama did not send \`contents\`. ` +
            `Call read_file('${p}'), then search_replace to add code, or write_file with the full file in \`contents\`.`
          );
        }
        return 'Error: write_file requires path and non-missing contents (use `contents` with the full file body).';
      }
      let { path: p, contents } = normalized;
      p = normalizeToolFilePath(p);
      if (ctx.userMessage && !isWritePathAllowedForMessage(ctx.userMessage, p)) {
        const target = ctx.userMessage.match(/@([^\s@]+\.[a-z0-9]{1,8})/i)?.[1] ?? 'the mentioned file';
        return (
          `Error: User asked to edit @${target}, not package.json. ` +
          `Use read_file + search_replace on ${target} to add the API route.`
        );
      }
      contents = sanitizeFileContents(contents);
      if (looksLikeTutorialOrToolLeak(contents)) {
        return (
          'Error: write_file refused — contents are chat/tutorial text or leaked tool JSON, not source. ' +
          'Call write_file again with ONLY the file body (no ### Step, no ```json tool blocks).'
        );
      }
      if (looksLikePlaceholderStub(contents)) {
        return (
          'Error: write_file refused — contents are placeholder comments only, not a real implementation. ' +
          'Call read_file on similar files in the repo, then write_file with complete TypeScript/JavaScript source.'
        );
      }
      const invalid = validateWriteContents(contents, p);
      if (invalid) {
        return `Error: write_file refused — ${invalid}. Use read_file on the target, then write_file with complete valid source (path without @ prefix).`;
      }
      if (!contents.trim()) {
        return 'Error: write_file refused empty contents. Call write_file again with the full file implementation in `contents`.';
      }
      const absCheck = path.resolve(ws, p);
      const existedBefore = fs.existsSync(absCheck);
      const oldContent = existedBefore ? fs.readFileSync(absCheck, 'utf8') : '';
      const destructive = validateDestructiveOverwrite(contents, p, oldContent);
      if (destructive) {
        return `Error: write_file refused — ${destructive}.`;
      }
      const stats = ctx.writeStatsByPath?.get(p);
      if (stats && contents.length < stats.chars * 0.85) {
        return (
          `Error: Refusing a smaller second write to ${p} in the same request ` +
          `(${contents.length} chars vs ${stats.chars} already written). ` +
          `Call read_file('${p}') and use search_replace to fix errors.`
        );
      }
      if (stats && stats.count >= 2) {
        return (
          `Error: Already wrote to ${p} twice this request. ` +
          `Use read_file + search_replace for further edits.`
        );
      }
      const resolved = resolveWritePath(p, contents);
      p = resolved.path;
      const pathNote = resolved.corrected
        ? ` (renamed from invalid slug path to ${p})`
        : '';
      const abs = path.resolve(ws, p);
      const existed = existedBefore;
      const old = oldContent;
      contents = prepareJsonWrite(p, contents, old);
      const writeToDisk = async (rel: string, body: string): Promise<string | void> => {
        if (bridge) return bridge.writeFile(rel, body) as Promise<string | void>;
        const a = path.resolve(ws, rel);
        fs.mkdirSync(path.dirname(a), { recursive: true });
        fs.writeFileSync(a, body);
        ctx.indexer?.updateFile(rel);
      };
      const writeToDiskForDeps = async (rel: string, body: string): Promise<void> => {
        await writeToDisk(rel, body);
      };

      const writeResult = await writeToDisk(p, contents);
      ctx.onDiff?.(p, old, contents);
      ctx.writeStatsByPath?.set(p, {
        chars: contents.length,
        count: (ctx.writeStatsByPath.get(p)?.count ?? 0) + 1,
      });

      let depNote = '';
      const skipAutoPkg =
        ctx.userMessage &&
        hasExplicitFileMention(ctx.userMessage) &&
        !/\bpackage\.json\b/i.test(ctx.userMessage);
      if (!/\.json$/i.test(p) && !skipAutoPkg) {
        const added = ensurePackageJsonDependencies(ws, contents, writeToDiskForDeps);
        if (added) depNote = `\n${added}`;
      }

      if (bridge && typeof writeResult === 'string' && /proposed|approve|reject/i.test(writeResult)) {
        return `${writeResult}${pathNote}${depNote}`;
      }

      const lines = contents.split('\n').length;
      const verb = existed ? 'Updated existing file' : 'Created new file';
      const hint = existed
        ? ' (file already existed — prefer read_file + search_replace next time unless replacing entirely)'
        : '';
      const jsonNote = /\.json$/i.test(p) ? ' (JSON pretty-printed on disk)' : '';
      return `${verb} ${p} (${lines} lines, ${contents.length} chars)${pathNote}${hint}${jsonNote}${depNote}`;
    }
    case 'search_replace': {
      const p = normalizeToolFilePath(String(args.path ?? ''));
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const replaceAll = args.replace_all as boolean | undefined;
      const absSr = path.resolve(ws, p);
      if (!fs.existsSync(absSr)) return `Error: File not found: ${p}`;
      const originalSr = fs.readFileSync(absSr, 'utf8');
      let patchedSr = originalSr;
      if (replaceAll) patchedSr = patchedSr.split(oldStr).join(newStr);
      else patchedSr = patchedSr.replace(oldStr, newStr);
      patchedSr = prepareJsonWrite(p, patchedSr, originalSr);
      if (bridge) {
        const result = await bridge.searchReplace(p, oldStr, newStr, replaceAll);
        ctx.onDiff?.(p, originalSr, patchedSr);
        return result;
      }
      const abs = path.resolve(ws, p);
      const original = fs.readFileSync(abs, 'utf8');
      let content = original;
      if (replaceAll) content = content.split(oldStr).join(newStr);
      else content = content.replace(oldStr, newStr);
      content = prepareJsonWrite(p, content, original);
      fs.writeFileSync(abs, content);
      ctx.indexer?.updateFile(p);
      ctx.onDiff?.(p, original, content);
      return `Patched ${p}`;
    }
    case 'glob':
      if (bridge) return (await bridge.glob(args.pattern as string, args.cwd as string | undefined)).join('\n');
      return localGlob(ws, args.pattern as string, args.cwd as string | undefined).join('\n');
    case 'grep':
      if (bridge) return bridge.grep(args.pattern as string, args.path as string | undefined);
      return localGrep(ws, args.pattern as string, args.path as string | undefined);
    case 'inspect_workspace':
      return inspectWorkspaceSetup(ws);
    case 'list_dir': {
      const p = (args.path as string) || '.';
      if (bridge) return bridge.listDir(p);
      const abs = path.resolve(ws, p);
      return fs.readdirSync(abs, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n');
    }
    case 'run_terminal':
    case 'Shell': {
      const cmd = args.command as string;
      if (bridge) {
        return bridge.runTerminal(
          cmd,
          args.cwd as string | undefined,
          args.block_until_ms as number | undefined
        );
      }
      try {
        const out = execSync(cmd, {
          cwd: args.cwd ? path.resolve(ws, args.cwd as string) : ws,
          encoding: 'utf8',
          timeout: (args.block_until_ms as number) ?? 30_000,
          maxBuffer: 2_000_000,
        });
        return out;
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        return `${err.stdout ?? ''}\n${err.stderr ?? ''}\nExit: ${err.message}`;
      }
    }
    case 'read_lints':
      if (bridge) return bridge.readLints(args.paths as string[] | undefined);
      return '(no IDE bridge — lints unavailable)';
    case 'codebase_search': {
      if (!ctx.indexer) return 'Indexer not ready — run Rubynod: Build Codebase Index';
      const pack = ctx.indexer.getContextPack(args.query as string, {
        limit: (args.limit as number) ?? 12,
      });
      return pack.formatted || '(no results)';
    }
    case 'todo_write':
      return JSON.stringify(args);
    case 'switch_mode': {
      const mode = args.mode as AgentMode;
      ctx.onModeSwitch?.(mode);
      return `Switched to ${mode} mode`;
    }
    case 'web_search':
      return webSearch(args.query as string);
    case 'save_memory': {
      const entry = appendMemory(ws, args.text as string);
      return `Saved memory ${entry.id}`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
