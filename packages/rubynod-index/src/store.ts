import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { IndexChunk, IndexSymbol, IndexStats, SearchResult } from './types.js';
import { embedText, cosineSimilarity } from './embeddings.js';

export class IndexStore {
  private db: Database.Database;

  constructor(workspaceRoot: string) {
    const dir = path.join(workspaceRoot, '.rubynod', 'index');
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(path.join(dir, 'chunks.db'));
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER,
        size INTEGER,
        indexed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        symbol_name TEXT,
        symbol_kind TEXT,
        embedding BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        container TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_path ON symbols(path);
    `);
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          path, content, content='chunks', content_rowid='rowid'
        );
      `);
    } catch {
      // FTS5 optional if sqlite build lacks it
    }
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  clear(): void {
    this.db.exec('DELETE FROM chunks; DELETE FROM symbols; DELETE FROM files;');
    try {
      this.db.exec('DELETE FROM chunks_fts;');
    } catch {
      // ignore
    }
  }

  upsertFile(relPath: string, mtimeMs: number, size: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO files (path, mtime_ms, size, indexed_at) VALUES (?, ?, ?, ?)`
      )
      .run(relPath, mtimeMs, size, new Date().toISOString());
  }

  upsertChunks(chunks: IndexChunk[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, content, symbol_name, symbol_kind, embedding)
      VALUES (@id, @path, @startLine, @endLine, @content, @symbolName, @symbolKind, @embedding)
    `);
    const tx = this.db.transaction((items: IndexChunk[]) => {
      for (const c of items) {
        const embedding = c.embedding ?? embedText(c.content);
        stmt.run({
          id: c.id,
          path: c.path,
          startLine: c.startLine,
          endLine: c.endLine,
          content: c.content,
          symbolName: c.symbolName ?? null,
          symbolKind: c.symbolKind ?? null,
          embedding: Buffer.from(new Float32Array(embedding).buffer),
        });
      }
    });
    tx(chunks);
  }

  upsertSymbols(symbols: IndexSymbol[]): void {
    const del = this.db.prepare('DELETE FROM symbols WHERE path = ?');
    const ins = this.db.prepare(`
      INSERT INTO symbols (path, name, kind, start_line, end_line, container)
      VALUES (@path, @name, @kind, @start_line, @end_line, @container)
    `);
    const byPath = new Map<string, IndexSymbol[]>();
    for (const s of symbols) {
      if (!byPath.has(s.path)) byPath.set(s.path, []);
      byPath.get(s.path)!.push(s);
    }
    const tx = this.db.transaction(() => {
      for (const [p, list] of byPath) {
        del.run(p);
        for (const s of list) {
          ins.run({
            path: s.path,
            name: s.name,
            kind: s.kind,
            start_line: s.startLine,
            end_line: s.endLine,
            container: s.container ?? null,
          });
        }
      }
    });
    if (symbols.length) tx();
  }

  removePath(filePath: string): void {
    this.db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);
    this.db.prepare('DELETE FROM symbols WHERE path = ?').run(filePath);
    this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  }

  getFileMtime(relPath: string): number | null {
    const row = this.db.prepare('SELECT mtime_ms FROM files WHERE path = ?').get(relPath) as
      | { mtime_ms: number }
      | undefined;
    return row?.mtime_ms ?? null;
  }

  searchSymbols(query: string, limit = 20): IndexSymbol[] {
    const q = `%${query.toLowerCase()}%`;
    return this.db
      .prepare(
        `SELECT path, name, kind, start_line as startLine, end_line as endLine, container
         FROM symbols WHERE lower(name) LIKE ? OR lower(path) LIKE ?
         LIMIT ?`
      )
      .all(q, q, limit) as IndexSymbol[];
  }

  hybridSearch(query: string, limit = 12, candidateLimit = 400): SearchResult[] {
    const text = this.textSearch(query, candidateLimit);
    const semantic = this.semanticSearch(query, limit * 3, text);
    const symbolHits = this.searchSymbols(query, 8);

    const merged = new Map<string, SearchResult>();
    const key = (r: SearchResult) => `${r.path}:${r.startLine}`;

    for (const r of semantic) merged.set(key(r), r);
    for (const r of text) {
      const k = key(r);
      const ex = merged.get(k);
      if (ex) ex.score = Math.max(ex.score, r.score);
      else merged.set(k, r);
    }

    for (const s of symbolHits) {
      const chunk = this.db
        .prepare(
          `SELECT content FROM chunks WHERE path = ? AND start_line <= ? AND end_line >= ? LIMIT 1`
        )
        .get(s.path, s.startLine, s.startLine) as { content: string } | undefined;
      const k = `${s.path}:${s.startLine}`;
      if (!merged.has(k)) {
        merged.set(k, {
          path: s.path,
          startLine: s.startLine,
          endLine: s.endLine,
          content: chunk?.content ?? `${s.kind} ${s.name}`,
          score: 0.55,
          matchType: 'symbol',
        });
      }
    }

    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private semanticSearch(
    query: string,
    limit: number,
    textCandidates: SearchResult[]
  ): SearchResult[] {
    const queryEmbed = embedText(query);
    const results: SearchResult[] = [];

    const scoreRow = (row: {
      path: string;
      start_line: number;
      end_line: number;
      content: string;
      embedding: Buffer | null;
    }) => {
      if (!row.embedding) return;
      const arr = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4
      );
      const semantic = cosineSimilarity(queryEmbed, Array.from(arr));
      if (semantic > 0.08) {
        results.push({
          path: row.path,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          score: semantic * 0.65,
          matchType: 'semantic',
        });
      }
    };

    if (textCandidates.length > 0) {
      const stmt = this.db.prepare(
        `SELECT path, start_line, end_line, content, embedding FROM chunks
         WHERE path = ? AND start_line = ? LIMIT 1`
      );
      for (const c of textCandidates) {
        const row = stmt.get(c.path, c.startLine) as {
          path: string;
          start_line: number;
          end_line: number;
          content: string;
          embedding: Buffer | null;
        } | undefined;
        if (row) scoreRow(row);
      }
    } else {
      const rows = this.db
        .prepare(
          `SELECT path, start_line, end_line, content, embedding FROM chunks
           WHERE embedding IS NOT NULL LIMIT 200`
        )
        .all() as Array<{
        path: string;
        start_line: number;
        end_line: number;
        content: string;
        embedding: Buffer | null;
      }>;
      for (const row of rows) scoreRow(row);
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private textSearch(query: string, limit: number): SearchResult[] {
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    if (!tokens.length) return [];

    const primary = tokens[0]!;
    const rows = this.db
      .prepare(
        `SELECT path, start_line, end_line, content FROM chunks
         WHERE lower(content) LIKE '%' || ? || '%'
         LIMIT ?`
      )
      .all(primary, limit) as Array<{
      path: string;
      start_line: number;
      end_line: number;
      content: string;
    }>;

    const results: SearchResult[] = [];
    for (const row of rows) {
      const lower = row.content.toLowerCase();
      let hits = 0;
      for (const t of tokens) if (lower.includes(t)) hits++;
      const score = hits / tokens.length;
      if (score > 0.15) {
        results.push({
          path: row.path,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          score: score * 0.35,
          matchType: 'text',
        });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  getStats(indexing: boolean): IndexStats {
    const chunks = this.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as { c: number };
    const files = this.db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number };
    const symbols = this.db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number };
    return {
      chunkCount: chunks.c,
      fileCount: files.c,
      symbolCount: symbols.c,
      lastIndexedAt: this.getMeta('lastIndexedAt'),
      indexing,
    };
  }
}
