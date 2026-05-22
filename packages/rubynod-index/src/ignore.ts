import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

const DEFAULT_IGNORE = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.rubynod',
  'vendor',
  '.next',
  'coverage',
  'target',
  'out',
  '__pycache__',
  '.turbo',
  '*.min.js',
  '*.map',
];

const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.go', '.rs',
  '.java', '.kt', '.rb', '.php', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.sql', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss',
  '.vue', '.svelte', '.sh', '.bash', '.zsh', '.graphql',
]);

type MatcherCache = {
  matcher: Ignore;
  signature: string;
};

const matcherByRoot = new Map<string, MatcherCache>();

function configSignature(workspaceRoot: string): string {
  const names = ['.gitignore', '.rubynodignore', '.cursorignore'];
  const parts = [workspaceRoot];
  for (const name of names) {
    const p = path.join(workspaceRoot, name);
    try {
      const st = fs.statSync(p);
      parts.push(`${name}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${name}:missing`);
    }
  }
  return parts.join('|');
}

function buildMatcher(workspaceRoot: string): Ignore {
  const ig = ignore();
  for (const pat of DEFAULT_IGNORE) {
    ig.add(pat);
    if (!pat.includes('/')) ig.add(`${pat}/`);
  }
  for (const name of ['.gitignore', '.rubynodignore', '.cursorignore']) {
    const p = path.join(workspaceRoot, name);
    if (fs.existsSync(p)) {
      ig.add(fs.readFileSync(p, 'utf8'));
    }
  }
  return ig;
}

/** Cached gitignore-style matcher (rebuilt when ignore files change). */
export function getIndexIgnoreMatcher(workspaceRoot: string): Ignore {
  const root = path.resolve(workspaceRoot);
  const signature = configSignature(root);
  const cached = matcherByRoot.get(root);
  if (cached && cached.signature === signature) return cached.matcher;
  const matcher = buildMatcher(root);
  matcherByRoot.set(root, { matcher, signature });
  return matcher;
}

export function isIndexableExtension(relativePath: string): boolean {
  const ext = path.extname(relativePath).toLowerCase();
  return TEXT_EXTS.has(ext) || !ext;
}

/** @deprecated Use getIndexIgnoreMatcher — kept for tests/tools */
export function shouldIndex(relativePath: string, workspaceRoot: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const ig = getIndexIgnoreMatcher(workspaceRoot);
  if (ig.ignores(normalized) || ig.ignores(`${normalized}/`)) return false;
  return isIndexableExtension(normalized);
}

export function shouldIndexDirectory(relativePath: string, workspaceRoot: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized) return true;
  const ig = getIndexIgnoreMatcher(workspaceRoot);
  return !ig.ignores(`${normalized}/`);
}

export function shouldIndexFile(relativePath: string, workspaceRoot: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const ig = getIndexIgnoreMatcher(workspaceRoot);
  if (ig.ignores(normalized)) return false;
  return isIndexableExtension(normalized);
}
