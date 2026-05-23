import fs from 'node:fs';
import path from 'node:path';
import { normalizeToolFilePath } from './sanitize-code.js';

const SERVER_CANDIDATES = [
  'server.js',
  'index.js',
  'app.js',
  'main.js',
  'src/index.js',
  'src/server.js',
  'src/app.js',
  'src/index.ts',
  'src/main.ts',
  'src/server.ts',
];

const SETUP_SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.rubynod']);

interface PackageSummary {
  name?: string;
  type?: string;
  scripts: Record<string, string>;
  hasExpress: boolean;
}

function readPackageJson(root: string): PackageSummary | null {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      name?: string;
      type?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const deps = { ...raw.dependencies, ...raw.devDependencies };
    return {
      name: raw.name,
      type: raw.type,
      scripts: raw.scripts ?? {},
      hasExpress: Boolean(deps.express),
    };
  } catch {
    return null;
  }
}

function listRootSummary(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => !SETUP_SKIP.has(e.name) && !e.name.startsWith('.'))
      .slice(0, 24)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  } catch {
    return [];
  }
}

function suggestRunCommand(
  pkg: PackageSummary | null,
  serverPath: string | undefined
): string | undefined {
  if (pkg?.scripts.start) return 'npm start';
  if (pkg?.scripts.dev) return 'npm run dev';
  if (serverPath) {
    if (pkg?.type === 'module') return `node ${serverPath}`;
    return `node ${serverPath}`;
  }
  if (!pkg && serverPath) return `node ${serverPath}`;
  return undefined;
}

/** Structured workspace snapshot for the agent (files, Node setup, run hints). */
export function inspectWorkspaceSetup(workspaceRoot: string): string {
  const pkg = readPackageJson(workspaceRoot);
  const hasNodeModules = fs.existsSync(path.join(workspaceRoot, 'node_modules'));
  const rootFiles = listRootSummary(workspaceRoot);

  const entries: Array<{ path: string; exists: boolean }> = [];
  for (const rel of SERVER_CANDIDATES) {
    entries.push({
      path: rel,
      exists: fs.existsSync(path.join(workspaceRoot, rel)),
    });
  }

  const existingServers = entries.filter((e) => e.exists).map((e) => e.path);
  const primaryServer = existingServers[0];
  const runCmd = suggestRunCommand(pkg, primaryServer);

  const lines: string[] = [
    '## Workspace setup snapshot (auto)',
    '',
    `Root: ${workspaceRoot}`,
    '',
    '### Project layout',
    rootFiles.length ? rootFiles.map((f) => `- ${f}`).join('\n') : '- (empty or unreadable)',
    '',
    '### Node / npm',
    `- package.json: ${pkg ? 'yes' : 'no'}`,
  ];

  if (pkg) {
    lines.push(`- name: ${pkg.name ?? '(unnamed)'}`);
    if (pkg.type) lines.push(`- type: ${pkg.type}`);
    lines.push(`- node_modules: ${hasNodeModules ? 'yes' : 'no (run npm install before npm start)'}`);
    const scriptKeys = Object.keys(pkg.scripts);
    if (scriptKeys.length) {
      lines.push('- scripts: ' + scriptKeys.map((k) => `${k} → ${pkg.scripts[k]}`).join(', '));
    } else {
      lines.push('- scripts: (none — add a "start" script if you want npm start)');
    }
    lines.push(`- express in dependencies: ${pkg.hasExpress ? 'yes' : 'no'}`);
  } else {
    lines.push('- node_modules: n/a (no package.json)');
  }

  lines.push('', '### Server / entry files');
  if (existingServers.length) {
    for (const s of existingServers) lines.push(`- exists: ${s}`);
    lines.push('- Action: read existing file(s) before creating or overwriting.');
  } else {
    lines.push('- No common server entry found yet (server.js, index.js, src/index.ts, …).');
    lines.push('- Action: only create server.js (or agreed path) if user asked for a new server.');
  }

  if (runCmd) {
    lines.push('', '### Suggested run command (ask user before run_terminal)');
    lines.push(`\`${runCmd}\``);
  } else if (!pkg && !primaryServer) {
    lines.push('', '### If user wants to run Node later');
    lines.push(
      'Minimal setup order: (1) package.json with name + scripts.start, (2) npm install <deps>, (3) server file, (4) suggest `npm start` or `node server.js` — use run_terminal only after user approves.'
    );
  }

  lines.push(
    '',
    '### Agent rules for this task',
    '- Do NOT scaffold or bootstrap unless needed to run or user asked for full setup.',
    '- Before write_file: use read_file or glob — if target exists, read and update (search_replace) instead of blind overwrite.',
    '- Create package.json only when missing AND needed (npm scripts, dependencies, or user asked to run with npm).',
    '- Tell the user the exact command in chat first; call run_terminal only when they want to execute (IDE shows Approve/Reject).'
  );

  return lines.join('\n');
}

const RESERVED_MENTIONS = new Set([
  'codebase',
  'web',
  'symbol',
  'folder',
  'file',
  'typescript',
  'javascript',
]);

/** Paths from @server.js / @src/foo.ts in the user message (composer mentions). */
export function extractMentionedFilePaths(message: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /@([^\s@/]+(?:\/[^\s@]+)*\.[a-z0-9]{1,8})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    const raw = m[1]!.toLowerCase();
    if (RESERVED_MENTIONS.has(raw.split('/')[0]!)) continue;
    const p = normalizeToolFilePath(m[1]!);
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export function hasExplicitFileMention(message: string): boolean {
  return extractMentionedFilePaths(message).length > 0;
}

/** Prefer forcing tool calls when the user asks to create or implement files/services. */
export function shouldRequireAgentTools(message: string): boolean {
  if (hasExplicitFileMention(message)) return true;
  const m = message.toLowerCase();
  return (
    /\b(create|add|implement|scaffold|build|generate|write|make)\b/.test(m) &&
    /\b(file|files|service|module|package|folder|directory|library|client)\b/.test(m)
  );
}

/** User wants to install deps already declared in package.json (not add new packages one-by-one). */
export function isNpmInstallIntent(message: string): boolean {
  const m = message.toLowerCase();
  if (/\bnpm\s+ci\b/.test(m)) return true;
  if (/\binstall\b/.test(m) && /\bpackage\.json\b/.test(m)) return true;
  if (/\b(install|setup|set up|bootstrap)\b/.test(m) && /\b(packages?|dependencies|deps|node_modules)\b/.test(m)) {
    return true;
  }
  return /\b(install|setup|set up)\b/.test(m) && /\b(project|workspace|repo)\b/.test(m) && /\b(packages?|dependencies|deps)\b/.test(m);
}

/** Steer the model away from per-package `npm install --save-dev` loops. */
export function buildNpmInstallDirective(workspaceRoot: string): string {
  const hasLock = fs.existsSync(path.join(workspaceRoot, 'package-lock.json'));
  return (
    `### npm install (this turn)\n` +
    `- User wants dependencies from package.json installed — not to add new packages one-by-one.\n` +
    `- From the workspace root, run **\`npm install\`** (installs all dependencies and devDependencies; respects package-lock.json when present).\n` +
    `- For a clean reproducible install (CI / fresh clone), use **\`npm ci\`** when package-lock.json exists.\n` +
    `- Do **NOT** loop with jq or run \`npm install --save-dev <name>\` for each key in package.json.\n` +
    `- \`@package.json\` in chat is a file reference — the path is \`package.json\`, not a file named \`@package.json\`.\n` +
    `- npm workspaces monorepos: one \`npm install\` at the repo root installs all workspace packages.\n` +
    `- Flow: \`inspect_workspace\` if unsure → state \`npm install\` in chat → \`run_terminal\` after user approves.` +
    (hasLock ? '\n- package-lock.json is present — prefer `npm install` or `npm ci`, not ad-hoc per-package installs.' : '')
  );
}

/** Tell the model to edit only the @mentioned file(s), not dump package.json in chat. */
export function buildFocusedFileDirective(message: string, workspaceRoot: string): string | null {
  const files = extractMentionedFilePaths(message);
  if (!files.length) return null;
  if (isNpmInstallIntent(message) && files.every((f) => f === 'package.json')) {
    return buildNpmInstallDirective(workspaceRoot);
  }
  return (
    `### User target file(s)\n` +
    files.map((f) => `- ${f}`).join('\n') +
    '\n\nRules for this turn:\n' +
    `- Edit ONLY these file(s) unless the user also named another path.\n` +
    `- Call read_file('${files[0]}') first, then search_replace (or write_file) to apply edits.\n` +
    `- When the user asks to improve, fix, update, or change the file: edit via tools — do NOT paste a full replacement in chat.\n` +
    `- Do NOT output [tool_calls], tool JSON, or bare \`{\` in the chat — use native tool calls only.\n` +
    `- Do NOT paste or rewrite package.json in the chat response.\n` +
    `- Do NOT write_file('package.json') unless the user explicitly asked for package.json.\n` +
    `- Answer briefly after tools run (e.g. "Added user details to logger.js").`
  );
}

/** Block writes to package.json when the user @mentioned a different file only (not install-deps turns). */
export function isWritePathAllowedForMessage(userMessage: string, relPath: string): boolean {
  if (isNpmInstallIntent(userMessage)) return true;
  const focused = extractMentionedFilePaths(userMessage);
  if (!focused.length) return true;
  const p = normalizeToolFilePath(relPath);
  if (p !== 'package.json') return true;
  if (/\bpackage\.json\b/i.test(userMessage)) return true;
  return false;
}

/** Whether to attach workspace snapshot to the user message automatically. */
export function shouldAttachWorkspaceSetup(message: string): boolean {
  if (isNpmInstallIntent(message)) return true;
  if (hasExplicitFileMention(message)) return false;
  const m = message.toLowerCase();
  return (
    /\b(server|express|node\.?js|npm|package\.json)\b/.test(m) ||
    (/\b(create|add|make|build|setup|scaffold|run|start)\b/.test(m) &&
      /\b(file|project|app|api|backend)\b/.test(m))
  );
}
