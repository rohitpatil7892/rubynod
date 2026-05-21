import fs from 'node:fs';
import path from 'node:path';

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

/** Whether to attach workspace snapshot to the user message automatically. */
export function shouldAttachWorkspaceSetup(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /\b(server|express|node\.?js|npm|package\.json)\b/.test(m) ||
    /\b(create|add|make|build|setup|scaffold|run|start)\b/.test(m) &&
      /\b(file|project|app|api|backend)\b/.test(m)
  );
}
