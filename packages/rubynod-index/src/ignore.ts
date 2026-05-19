import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';

const DEFAULT_IGNORE = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.rubynod/**',
  '**/vendor/**',
  '**/*.min.js',
  '**/*.map',
];

function loadPatterns(workspaceRoot: string): string[] {
  const patterns = [...DEFAULT_IGNORE];
  for (const name of ['.gitignore', '.rubynodignore', '.cursorignore']) {
    const p = path.join(workspaceRoot, name);
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (t && !t.startsWith('#')) patterns.push(t);
      }
    }
  }
  return patterns;
}

export function shouldIndex(relativePath: string, workspaceRoot: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const patterns = loadPatterns(workspaceRoot);
  for (const pat of patterns) {
    if (minimatch(normalized, pat, { dot: true })) return false;
    if (minimatch(normalized, `**/${pat}`, { dot: true })) return false;
  }
  const ext = path.extname(normalized).toLowerCase();
  const textExts = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.go', '.rs',
    '.java', '.kt', '.rb', '.php', '.cs', '.cpp', '.c', '.h', '.hpp',
    '.sql', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss',
    '.vue', '.svelte', '.sh', '.bash', '.zsh', '.dockerfile', '.graphql',
  ]);
  return textExts.has(ext) || !ext;
}
