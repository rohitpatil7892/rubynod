import fs from 'node:fs';
import path from 'node:path';
import type { IndexChunk } from './types.js';
import { chunkFileSmart } from './symbol-chunker.js';
import { shouldIndexDirectory, shouldIndexFile } from './ignore.js';

export function chunkFile(filePath: string, content: string): IndexChunk[] {
  return chunkFileSmart(filePath, content);
}

export function walkWorkspace(root: string, workspaceRoot?: string): string[] {
  const wsRoot = path.resolve(workspaceRoot ?? root);
  const files: string[] = [];

  function walk(dir: string, relBase: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!shouldIndexDirectory(rel, wsRoot)) continue;
        walk(full, rel);
      } else if (ent.isFile()) {
        if (!shouldIndexFile(rel, wsRoot)) continue;
        files.push(full);
      }
    }
  }

  walk(path.resolve(root), '');
  return files;
}

export function readFileChunks(absPath: string, relPath: string): IndexChunk[] {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > 512_000) return [];
    const content = fs.readFileSync(absPath, 'utf8');
    return chunkFile(relPath, content);
  } catch {
    return [];
  }
}
