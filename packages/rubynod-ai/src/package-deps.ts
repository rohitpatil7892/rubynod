import fs from 'node:fs';
import path from 'node:path';
import { prepareJsonWrite } from './json-write.js';

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

/** Map import name → npm package name when they differ. */
const IMPORT_ALIASES: Record<string, string> = {
  bcrypt: 'bcrypt',
  bcryptjs: 'bcryptjs',
  cors: 'cors',
  dotenv: 'dotenv',
  express: 'express',
  jsonwebtoken: 'jsonwebtoken',
  mongoose: 'mongoose',
  mysql: 'mysql',
  mysql2: 'mysql2',
  pg: 'pg',
  sequelize: 'sequelize',
  sqlite3: 'sqlite3',
  ws: 'ws',
};

function parsePackageName(specifier: string): string | null {
  const s = specifier.trim();
  if (!s || s.startsWith('.') || s.startsWith('/')) return null;
  if (s.startsWith('node:')) return null;
  if (NODE_BUILTINS.has(s.split('/')[0]!)) return null;
  if (s.startsWith('@')) {
    const parts = s.split('/');
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return null;
  }
  return s.split('/')[0]!;
}

/** Detect npm packages from import/require statements in source. */
export function detectNpmDependencies(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const pkg = parsePackageName(m[1]!);
      if (!pkg) continue;
      found.add(IMPORT_ALIASES[pkg] ?? pkg);
    }
  }
  return [...found].sort();
}

/**
 * After writing a code file, merge detected imports into package.json dependencies.
 */
export function ensurePackageJsonDependencies(
  workspaceRoot: string,
  sourceContents: string,
  writeFile: (relPath: string, content: string) => void | Promise<void>
): string | undefined {
  const deps = detectNpmDependencies(sourceContents);
  if (!deps.length) return undefined;

  const pkgPath = path.join(workspaceRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;

  const oldRaw = fs.readFileSync(pkgPath, 'utf8');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(oldRaw) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const existing =
    (pkg.dependencies as Record<string, string> | undefined) ?? {};
  const added: string[] = [];
  const nextDeps: Record<string, string> = { ...existing };

  for (const name of deps) {
    if (nextDeps[name]) continue;
    nextDeps[name] = 'latest';
    added.push(name);
  }

  if (!added.length) return undefined;

  pkg.dependencies = nextDeps;
  const merged = prepareJsonWrite('package.json', JSON.stringify(pkg), oldRaw);
  void writeFile('package.json', merged);
  return `Added to package.json dependencies: ${added.join(', ')}`;
}
