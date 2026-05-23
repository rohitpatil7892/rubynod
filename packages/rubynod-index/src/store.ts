import type { Database } from 'sql.js';
import path from 'node:path';
import fs from 'node:fs';
import type { IndexChunk, IndexSymbol, IndexStats, SearchResult } from './types.js';
import { embedText, cosineSimilarity } from './embeddings.js';
import { getSqlEngine } from './sql-init.js';
import type { EmbeddingProvider } from './embedding-provider.js';

export class IndexStore {
  private db: Database;
  private readonly dbPath: string;
  private dirty = false;
  private batchDepth = 0;
  private embeddingProvider: EmbeddingProvider | null = null;

  setEmbeddingProvider(provider: EmbeddingProvider | null): void {
    this.embeddingProvider = provider;
  }

  constructor(workspaceRoot: string) {
    const dir = path.join(workspaceRoot, '.rubynod', 'index');
    fs.mkdirSync(dir, { recursive: true });
    this.dbPath = path.join(dir, 'chunks.db');
    const SQL = getSqlEngine();
    if (fs.existsSync(this.dbPath)) {
      const buf = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }
    this.initSchema();
    this.flush();
  }

  beginBatch(): void {
    this.batchDepth++;
  }

  endBatch(): void {
    this.batchDepth = Math.max(0, this.batchDepth - 1);
    if (this.batchDepth === 0) this.flush(true);
  }

  private flush(force = false): void {
    if (!this.dirty) return;
    if (this.batchDepth > 0 && !force) return;
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
    this.dirty = false;
  }

  private touch(): void {
    this.dirty = true;
  }

  private initSchema(): void {
    this.db.run(`
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
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          path, content, content='chunks', content_rowid='rowid'
        );
      `);
    } catch {
      // FTS5 optional
    }
    this.touch();
    this.flush();
  }

  setMeta(key: string, value: string): void {
    this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
    this.touch();
    this.flush();
  }

  getMeta(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    stmt.bind([key]);
    const row = stmt.step() ? (stmt.getAsObject() as { value: string }) : undefined;
    stmt.free();
    return row?.value ?? null;
  }

  clear(): void {
    this.db.run('DELETE FROM chunks');
    this.db.run('DELETE FROM symbols');
    this.db.run('DELETE FROM files');
    try {
      this.db.run('DELETE FROM chunks_fts');
    } catch {
      // ignore
    }
    this.touch();
    this.flush();
  }

  upsertFile(relPath: string, mtimeMs: number, size: number): void {
    this.db.run(
      `INSERT OR REPLACE INTO files (path, mtime_ms, size, indexed_at) VALUES (?, ?, ?, ?)`,
      [relPath, mtimeMs, size, new Date().toISOString()]
    );
    this.touch();
    this.flush();
  }

  async upsertChunksWithEmbeddings(chunks: IndexChunk[]): Promise<void> {
    if (!this.embeddingProvider || chunks.length === 0) {
      this.upsertChunks(chunks);
      return;
    }
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingProvider.embedBatch(texts);
    const enriched = chunks.map((c, i) => ({
      ...c,
      embedding: embeddings[i]?.length ? embeddings[i] : (c.embedding ?? embedText(c.content)),
    }));
    this.upsertChunks(enriched);
  }

  upsertChunks(chunks: IndexChunk[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, content, symbol_name, symbol_kind, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.run('BEGIN TRANSACTION');
    try {
      for (const c of chunks) {
        const embedding = c.embedding ?? embedText(c.content);
        const blob = new Uint8Array(new Float32Array(embedding).buffer);
        stmt.run([
          c.id,
          c.path,
          c.startLine,
          c.endLine,
          c.content,
          c.symbolName ?? null,
          c.symbolKind ?? null,
          blob,
        ]);
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    } finally {
      stmt.free();
    }
    this.touch();
    this.flush();
  }

  upsertSymbols(symbols: IndexSymbol[]): void {
    if (!symbols.length) return;
    const byPath = new Map<string, IndexSymbol[]>();
    for (const s of symbols) {
      if (!byPath.has(s.path)) byPath.set(s.path, []);
      byPath.get(s.path)!.push(s);
    }
    const del = this.db.prepare('DELETE FROM symbols WHERE path = ?');
    const ins = this.db.prepare(`
      INSERT INTO symbols (path, name, kind, start_line, end_line, container)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.db.run('BEGIN TRANSACTION');
    try {
      for (const [p, list] of byPath) {
        del.run([p]);
        for (const s of list) {
          ins.run([s.path, s.name, s.kind, s.startLine, s.endLine, s.container ?? null]);
        }
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    } finally {
      del.free();
      ins.free();
    }
    this.touch();
    this.flush();
  }

  removePath(filePath: string): void {
    this.db.run('DELETE FROM chunks WHERE path = ?', [filePath]);
    this.db.run('DELETE FROM symbols WHERE path = ?', [filePath]);
    this.db.run('DELETE FROM files WHERE path = ?', [filePath]);
    this.touch();
    this.flush();
  }

  getFileMtime(relPath: string): number | null {
    const stmt = this.db.prepare('SELECT mtime_ms FROM files WHERE path = ?');
    stmt.bind([relPath]);
    const row = stmt.step() ? (stmt.getAsObject() as { mtime_ms: number }) : undefined;
    stmt.free();
    return row?.mtime_ms ?? null;
  }

  searchSymbols(query: string, limit = 20): IndexSymbol[] {
    const q = `%${query.toLowerCase()}%`;
    const stmt = this.db.prepare(
      `SELECT path, name, kind, start_line as startLine, end_line as endLine, container
       FROM symbols WHERE lower(name) LIKE ? OR lower(path) LIKE ?
       LIMIT ?`
    );
    stmt.bind([q, q, limit]);
    const out: IndexSymbol[] = [];
    while (stmt.step()) {
      out.push(stmt.getAsObject() as unknown as IndexSymbol);
    }
    stmt.free();
    return out;
  }

  private isIdentifierQuery(query: string): boolean {
    // Looks like a CamelCase identifier, snake_case, or file.ts reference
    return /[A-Z][a-z]|_[a-z]|\.[a-z]{1,5}$/.test(query) && !/\s{2,}/.test(query);
  }

  hybridSearch(query: string, limit = 12, candidateLimit = 400, queryEmbedding?: number[]): SearchResult[] {
    const text = this.textSearch(query, candidateLimit);
    const semantic = this.semanticSearch(query, limit * 3, text, queryEmbedding);
    const symbolHits = this.searchSymbols(query, 8);

    const isIdentifier = this.isIdentifierQuery(query);
    // For identifier queries FTS wins; for NL queries semantic wins
    const ftsBoost = isIdentifier ? 1.15 : 0.9;
    const semBoost = isIdentifier ? 0.9 : 1.1;

    const merged = new Map<string, SearchResult>();
    const key = (r: SearchResult) => `${r.path}:${r.startLine}`;

    for (const r of semantic) {
      merged.set(key(r), { ...r, score: r.score * semBoost });
    }
    for (const r of text) {
      const k = key(r);
      const boosted = r.score * ftsBoost;
      const ex = merged.get(k);
      if (ex) ex.score = Math.max(ex.score, boosted);
      else merged.set(k, { ...r, score: boosted });
    }

    for (const s of symbolHits) {
      const stmt = this.db.prepare(
        `SELECT content FROM chunks WHERE path = ? AND start_line <= ? AND end_line >= ? LIMIT 1`
      );
      stmt.bind([s.path, s.startLine, s.startLine]);
      const chunk = stmt.step() ? (stmt.getAsObject() as { content: string }) : undefined;
      stmt.free();
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
    textCandidates: SearchResult[],
    precomputedEmbedding?: number[]
  ): SearchResult[] {
    const queryEmbed = precomputedEmbedding?.length ? precomputedEmbedding : embedText(query);
    const results: SearchResult[] = [];

    const scoreRow = (row: {
      path: string;
      start_line: number;
      end_line: number;
      content: string;
      embedding: Uint8Array | null;
    }) => {
      if (!row.embedding) return;
      const u8 = row.embedding;
      const arr = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
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
        stmt.bind([c.path, c.startLine]);
        const row = stmt.step()
          ? (stmt.getAsObject() as {
              path: string;
              start_line: number;
              end_line: number;
              content: string;
              embedding: Uint8Array | null;
            })
          : undefined;
        stmt.reset();
        if (row) scoreRow(row);
      }
      stmt.free();
    } else {
      const stmt = this.db.prepare(
        `SELECT path, start_line, end_line, content, embedding FROM chunks
         WHERE embedding IS NOT NULL LIMIT 200`
      );
      while (stmt.step()) {
        scoreRow(
          stmt.getAsObject() as {
            path: string;
            start_line: number;
            end_line: number;
            content: string;
            embedding: Uint8Array | null;
          }
        );
      }
      stmt.free();
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private textSearch(query: string, limit: number): SearchResult[] {
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    if (!tokens.length) return [];

    const primary = tokens[0]!;
    const stmt = this.db.prepare(
      `SELECT path, start_line, end_line, content FROM chunks
       WHERE lower(content) LIKE '%' || ? || '%'
       LIMIT ?`
    );
    stmt.bind([primary, limit]);
    const rows: Array<{
      path: string;
      start_line: number;
      end_line: number;
      content: string;
    }> = [];
    while (stmt.step()) {
      rows.push(
        stmt.getAsObject() as {
          path: string;
          start_line: number;
          end_line: number;
          content: string;
        }
      );
    }
    stmt.free();

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
    const chunks = this.scalar('SELECT COUNT(*) as c FROM chunks');
    const files = this.scalar('SELECT COUNT(*) as c FROM files');
    const symbols = this.scalar('SELECT COUNT(*) as c FROM symbols');
    return {
      chunkCount: chunks,
      fileCount: files,
      symbolCount: symbols,
      lastIndexedAt: this.getMeta('lastIndexedAt'),
      indexing,
    };
  }

  private scalar(sql: string): number {
    const stmt = this.db.prepare(sql);
    const row = stmt.step() ? (stmt.getAsObject() as { c: number }) : { c: 0 };
    stmt.free();
    return row.c;
  }
}
