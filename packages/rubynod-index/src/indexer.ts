import fs from 'node:fs';
import path from 'node:path';
import type { ContextPack, IndexProgress, IndexStats, IndexSymbol, SearchResult } from './types.js';
import { shouldIndex } from './ignore.js';
import { walkWorkspace } from './chunker.js';
import { chunkFileSmart } from './symbol-chunker.js';
import { IndexStore } from './store.js';
import { buildContextPack } from './context-pack.js';

const DEFAULT_BUILD_CONCURRENCY = Number(process.env.RUBYNOD_INDEX_CONCURRENCY ?? 8);

export class CodebaseIndexer {
  private store: IndexStore;
  private workspaceRoot: string;
  private indexing = false;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private buildConcurrency = DEFAULT_BUILD_CONCURRENCY;
  private searchCandidateLimit = Number(process.env.RUBYNOD_SEARCH_CANDIDATES ?? 400);

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.store = new IndexStore(this.workspaceRoot);
  }

  getStatus(): IndexStats {
    return this.store.getStats(this.indexing);
  }

  isIndexing(): boolean {
    return this.indexing;
  }

  setPerformanceOpts(opts: { buildConcurrency?: number; searchCandidateLimit?: number }): void {
    if (opts.buildConcurrency) this.buildConcurrency = opts.buildConcurrency;
    if (opts.searchCandidateLimit) this.searchCandidateLimit = opts.searchCandidateLimit;
  }

  async buildIndex(onProgress?: (p: IndexProgress) => void): Promise<IndexStats> {
    if (this.indexing) return this.getStatus();
    this.indexing = true;

    const files = walkWorkspace(this.workspaceRoot, (rel) =>
      shouldIndex(rel, this.workspaceRoot)
    );

    onProgress?.({
      phase: 'scanning',
      filesTotal: files.length,
      filesDone: 0,
      message: `Found ${files.length} files to index`,
    });

    this.store.clear();
    let done = 0;
    const concurrency = Math.max(1, this.buildConcurrency);

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      await Promise.all(batch.map((abs) => this.indexOneFile(abs, onProgress)));
      done += batch.length;
      onProgress?.({
        phase: 'indexing',
        filesTotal: files.length,
        filesDone: done,
        message: `Indexed ${done}/${files.length} files`,
      });
    }

    const now = new Date().toISOString();
    this.store.setMeta('lastIndexedAt', now);
    this.indexing = false;

    onProgress?.({
      phase: 'done',
      filesTotal: files.length,
      filesDone: files.length,
      message: `Index ready — ${this.getStatus().chunkCount} chunks`,
    });

    return this.getStatus();
  }

  private async indexOneFile(
    abs: string,
    _onProgress?: (p: IndexProgress) => void
  ): Promise<void> {
    const rel = path.relative(this.workspaceRoot, abs).replace(/\\/g, '/');
    try {
      const stat = fs.statSync(abs);
      if (stat.size > 512_000) return;

      const prevMtime = this.store.getFileMtime(rel);
      if (prevMtime !== null && prevMtime === stat.mtimeMs) return;

      const content = fs.readFileSync(abs, 'utf8');
      const chunks = chunkFileSmart(rel, content);
      if (chunks.length) {
        this.store.removePath(rel);
        this.store.upsertChunks(chunks);
        this.store.upsertFile(rel, stat.mtimeMs, stat.size);
      }
    } catch {
      // skip unreadable
    }
  }

  updateFile(relPath: string, symbols?: IndexSymbol[]): void {
    const normalized = relPath.replace(/\\/g, '/');
    const existing = this.debounceTimers.get(normalized);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      normalized,
      setTimeout(() => {
        this.debounceTimers.delete(normalized);
        const abs = path.join(this.workspaceRoot, normalized);
        if (!fs.existsSync(abs)) {
          this.store.removePath(normalized);
          return;
        }
        void this.indexOneFile(abs);
        if (symbols?.length) this.store.upsertSymbols(symbols);
      }, 400)
    );
  }

  ingestSymbols(symbols: IndexSymbol[]): void {
    if (symbols.length) this.store.upsertSymbols(symbols);
  }

  search(query: string, limit?: number): SearchResult[] {
    return this.store.hybridSearch(query, limit ?? 12, this.searchCandidateLimit);
  }

  /** Build ready-to-send context for the AI from the user query */
  getContextPack(query: string, opts?: { limit?: number; maxChars?: number }): ContextPack {
    const limit = opts?.limit ?? 10;
    const chunks = this.search(query, limit);
    const symbols = this.store.searchSymbols(query, 12);
    return buildContextPack(query, chunks, symbols, { maxChars: opts?.maxChars });
  }

  isReady(): boolean {
    return this.getStatus().chunkCount > 0 && !this.indexing;
  }
}
