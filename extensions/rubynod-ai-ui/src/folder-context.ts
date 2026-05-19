import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContextAttachment } from './context';
import { formatFileBlock } from './file-context';
import { getWorkspaceRoot, getFolderContextMaxFiles } from './settings';
import * as vscode from 'vscode';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.rubynod',
  'vendor',
  'out',
  '.next',
  'coverage',
]);

export interface FolderContextOptions {
  maxFiles?: number;
  maxFileChars?: number;
  includeTree?: boolean;
  includeFileBodies?: boolean;
}

interface FileEntry {
  rel: string;
  abs: string;
  size: number;
}

/** Cursor-style: folder tree summary + selected file contents */
export async function attachmentFromFolder(
  relPath: string,
  opts?: FolderContextOptions
): Promise<ContextAttachment | null> {
  const ws = getWorkspaceRoot();
  const normalized = relPath.replace(/\\/g, '/').replace(/\/$/, '');
  const abs = path.join(ws, normalized);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;

  const maxFiles = opts?.maxFiles ?? getFolderContextMaxFiles();
  const maxFileChars = opts?.maxFileChars ?? 4_000;
  const includeTree = opts?.includeTree !== false;
  const includeBodies = opts?.includeFileBodies !== false;

  const files = collectFiles(abs, normalized, maxFiles * 3);
  const tree = includeTree ? buildTree(abs, normalized, 4) : '';
  const priority = prioritizeFiles(files, maxFiles);

  const parts: string[] = [];
  parts.push(`# Folder: ${normalized}/\n`);

  if (tree) {
    parts.push(`## Directory structure\n\`\`\`\n${tree}\n\`\`\`\n`);
  }

  parts.push(`## Files included (${priority.length} of ${files.length} in folder)\n`);

  if (includeBodies) {
    for (const f of priority) {
      try {
        if (f.size > 120_000) {
          parts.push(`### ${f.rel}\n(too large: ${f.size} bytes — use @${f.rel} for partial read)\n`);
          continue;
        }
        const body = fs.readFileSync(f.abs, 'utf8').slice(0, maxFileChars);
        parts.push(formatFileBlock({ path: f.rel }, body));
      } catch {
        parts.push(`### ${f.rel}\n(binary or unreadable)\n`);
      }
    }
  } else {
    for (const f of priority) {
      parts.push(`- ${f.rel} (${f.size} bytes)`);
    }
  }

  return {
    type: 'folder',
    label: `${normalized}/`,
    content: parts.join('\n'),
    path: normalized,
  };
}

function collectFiles(absDir: string, relBase: string, limit: number): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (dir: string, rel: string) => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, relPath);
      else if (ent.isFile() && isTextFile(ent.name)) {
        try {
          const st = fs.statSync(full);
          out.push({ rel: relPath, abs: full, size: st.size });
        } catch {
          // skip
        }
      }
    }
  };
  walk(absDir, relBase === '.' ? '' : relBase.replace(/^\.\//, ''));
  return out;
}

function isTextFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  const text = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.go', '.rs', '.java',
    '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss', '.vue', '.sh',
    '.sql', '.graphql', '.rb', '.php', '.cs', '.cpp', '.h', '.swift', '.kt',
  ]);
  return text.has(ext) || !ext;
}

function buildTree(absDir: string, relBase: string, maxDepth: number, depth = 0, prefix = ''): string {
  if (depth >= maxDepth) return '';
  const lines: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return '';
  }
  const dirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));
  const files = entries.filter((e) => e.isFile() && isTextFile(e.name)).slice(0, 12);
  for (const d of dirs) {
    lines.push(`${prefix}${d.name}/`);
    lines.push(buildTree(path.join(absDir, d.name), `${relBase}/${d.name}`, maxDepth, depth + 1, prefix + '  '));
  }
  for (const f of files) {
    lines.push(`${prefix}${f.name}`);
  }
  if (entries.length > dirs.length + files.length) {
    lines.push(`${prefix}...`);
  }
  return lines.filter(Boolean).join('\n');
}

/** Prefer open editors + recently active files, then smaller files */
function prioritizeFiles(files: FileEntry[], max: number): FileEntry[] {
  const open = new Set(
    vscode.window.visibleTextEditors.map((e) =>
      path.relative(getWorkspaceRoot(), e.document.uri.fsPath).replace(/\\/g, '/')
    )
  );
  const scored = files.map((f) => {
    let score = 0;
    if (open.has(f.rel)) score += 100;
    if (f.size < 8_000) score += 20;
    if (f.size < 30_000) score += 10;
    return { f, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.f);
}
