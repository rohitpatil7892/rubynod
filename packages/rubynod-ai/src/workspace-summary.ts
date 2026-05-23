/**
 * Detect workspace stack and write `.rubynod/workspace-summary.json`.
 * Attached as low-priority context so the LLM knows the framework, test runner, DB, etc.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface WorkspaceSummary {
  generatedAt: string;
  language?: string;
  framework?: string;
  testRunner?: string;
  packageManager?: string;
  buildTool?: string;
  databases?: string[];
  hasMonorepo?: boolean;
}

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function detectWorkspaceSummary(wsRoot: string): WorkspaceSummary {
  const summary: WorkspaceSummary = { generatedAt: new Date().toISOString() };

  const pkg = readJsonIfExists(path.join(wsRoot, 'package.json'));
  const deps: Record<string, unknown> = {
    ...((pkg?.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg?.devDependencies as Record<string, unknown>) ?? {}),
  };

  // Language
  if (fileExists(path.join(wsRoot, 'tsconfig.json')) || deps['typescript']) {
    summary.language = 'TypeScript';
  } else if (pkg) {
    summary.language = 'JavaScript';
  } else if (fileExists(path.join(wsRoot, 'requirements.txt')) || fileExists(path.join(wsRoot, 'pyproject.toml'))) {
    summary.language = 'Python';
  } else if (fileExists(path.join(wsRoot, 'go.mod'))) {
    summary.language = 'Go';
  } else if (fileExists(path.join(wsRoot, 'Cargo.toml'))) {
    summary.language = 'Rust';
  }

  // Framework
  if (deps['next'] || deps['next.js']) summary.framework = 'Next.js';
  else if (deps['@remix-run/react']) summary.framework = 'Remix';
  else if (deps['react']) summary.framework = 'React';
  else if (deps['vue']) summary.framework = 'Vue';
  else if (deps['@angular/core']) summary.framework = 'Angular';
  else if (deps['svelte']) summary.framework = 'Svelte';
  else if (deps['express']) summary.framework = 'Express';
  else if (deps['fastify']) summary.framework = 'Fastify';
  else if (deps['hono']) summary.framework = 'Hono';
  else if (deps['@nestjs/core']) summary.framework = 'NestJS';

  // Test runner
  if (deps['vitest']) summary.testRunner = 'Vitest';
  else if (deps['jest']) summary.testRunner = 'Jest';
  else if (deps['mocha']) summary.testRunner = 'Mocha';
  else if (deps['@playwright/test']) summary.testRunner = 'Playwright';
  else if (fileExists(path.join(wsRoot, 'pytest.ini')) || fileExists(path.join(wsRoot, 'setup.cfg'))) {
    summary.testRunner = 'pytest';
  }

  // Package manager
  if (fileExists(path.join(wsRoot, 'pnpm-lock.yaml'))) summary.packageManager = 'pnpm';
  else if (fileExists(path.join(wsRoot, 'yarn.lock'))) summary.packageManager = 'yarn';
  else if (fileExists(path.join(wsRoot, 'package-lock.json'))) summary.packageManager = 'npm';
  else if (fileExists(path.join(wsRoot, 'bun.lockb'))) summary.packageManager = 'bun';

  // Build tool
  if (deps['vite']) summary.buildTool = 'Vite';
  else if (deps['webpack']) summary.buildTool = 'webpack';
  else if (deps['turbo'] || fileExists(path.join(wsRoot, 'turbo.json'))) summary.buildTool = 'Turborepo';
  else if (deps['@rspack/core']) summary.buildTool = 'Rspack';

  // Databases
  const dbs: string[] = [];
  if (deps['pg'] || deps['postgres'] || deps['@neondatabase/serverless']) dbs.push('PostgreSQL');
  if (deps['mysql2'] || deps['mysql']) dbs.push('MySQL');
  if (deps['mongodb'] || deps['mongoose']) dbs.push('MongoDB');
  if (deps['ioredis'] || deps['redis']) dbs.push('Redis');
  if (deps['better-sqlite3'] || deps['sql.js'] || deps['@libsql/client']) dbs.push('SQLite');
  if (deps['@prisma/client']) dbs.push('Prisma');
  if (deps['drizzle-orm']) dbs.push('Drizzle ORM');
  if (dbs.length) summary.databases = dbs;

  // Monorepo
  const isMonorepo =
    fileExists(path.join(wsRoot, 'pnpm-workspace.yaml')) ||
    fileExists(path.join(wsRoot, 'lerna.json')) ||
    fileExists(path.join(wsRoot, 'turbo.json')) ||
    !!(pkg?.workspaces);
  if (isMonorepo) summary.hasMonorepo = true;

  return summary;
}

export function saveWorkspaceSummary(wsRoot: string): WorkspaceSummary {
  const rubynodDir = path.join(wsRoot, '.rubynod');
  if (!fs.existsSync(rubynodDir)) {
    fs.mkdirSync(rubynodDir, { recursive: true });
  }
  const summary = detectWorkspaceSummary(wsRoot);
  const outPath = path.join(rubynodDir, 'workspace-summary.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}

export function loadWorkspaceSummary(wsRoot: string): WorkspaceSummary | null {
  const outPath = path.join(wsRoot, '.rubynod', 'workspace-summary.json');
  return readJsonIfExists(outPath) as WorkspaceSummary | null;
}

/** Build a compact system context attachment from the summary. */
export function workspaceSummaryAsContext(wsRoot: string): import('./types.js').ContextAttachment | null {
  const s = loadWorkspaceSummary(wsRoot);
  if (!s) return null;
  const parts: string[] = [];
  if (s.language) parts.push(`Language: ${s.language}`);
  if (s.framework) parts.push(`Framework: ${s.framework}`);
  if (s.testRunner) parts.push(`Test runner: ${s.testRunner}`);
  if (s.packageManager) parts.push(`Package manager: ${s.packageManager}`);
  if (s.buildTool) parts.push(`Build tool: ${s.buildTool}`);
  if (s.databases?.length) parts.push(`Databases/ORMs: ${s.databases.join(', ')}`);
  if (s.hasMonorepo) parts.push(`Monorepo: yes`);
  if (!parts.length) return null;
  return {
    type: 'rules',
    label: 'Workspace stack',
    content: `## Workspace stack\n${parts.join('\n')}`,
  };
}
