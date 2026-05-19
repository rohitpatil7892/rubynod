import { randomUUID } from 'node:crypto';
import type { IndexChunk } from './types.js';

const MAX_CHUNK_LINES = 100;
const OVERLAP = 6;

/** Split on blank lines or common definition patterns (function, class, export). */
const BOUNDARY =
  /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|def|func|impl|pub|fn|struct)\s/m;

export function chunkFileSmart(relPath: string, content: string): IndexChunk[] {
  const lines = content.split('\n');
  if (lines.length <= MAX_CHUNK_LINES) {
    return singleChunk(relPath, lines, 1, lines.length);
  }

  const boundaries: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    if (BOUNDARY.test(lines[i]!) || (lines[i] === '' && lines[i - 1] !== '')) {
      boundaries.push(i);
    }
  }
  boundaries.push(lines.length);

  const chunks: IndexChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = Math.min(start + MAX_CHUNK_LINES, lines.length);
    const nearBoundary = boundaries.find((b) => b > start && b <= end && b - start > 20);
    if (nearBoundary && nearBoundary < lines.length) end = nearBoundary;
    const slice = lines.slice(start, end);
    if (slice.join('').trim()) {
      chunks.push(...singleChunk(relPath, slice, start + 1, end));
    }
    if (end >= lines.length) break;
    start = Math.max(end - OVERLAP, start + 1);
  }

  return chunks.length ? chunks : chunkFileLines(relPath, content);
}

function singleChunk(relPath: string, lines: string[], startLine: number, endLine: number): IndexChunk[] {
  const content = lines.join('\n');
  if (!content.trim()) return [];
  return [
    {
      id: randomUUID(),
      path: relPath,
      startLine,
      endLine,
      content,
    },
  ];
}

/** Fallback: fixed-size windows */
export function chunkFileLines(relPath: string, content: string): IndexChunk[] {
  const lines = content.split('\n');
  const chunks: IndexChunk[] = [];
  for (let start = 0; start < lines.length; start += MAX_CHUNK_LINES - OVERLAP) {
    const end = Math.min(start + MAX_CHUNK_LINES, lines.length);
    const slice = lines.slice(start, end).join('\n');
    if (!slice.trim()) continue;
    chunks.push({
      id: randomUUID(),
      path: relPath,
      startLine: start + 1,
      endLine: end,
      content: slice,
    });
    if (end >= lines.length) break;
  }
  return chunks;
}
