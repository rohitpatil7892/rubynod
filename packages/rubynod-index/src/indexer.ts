import fs from 'node:fs';
import path from 'node:path';
import type { ContextPack, IndexProgress, IndexStats, IndexSymbol, SearchResult } from './types.js';
import { walkWorkspace } from './chunker.js';
import { chunkFileSmart } from './symbol-chunker.js';
import { IndexStore } from './store.js';
import { buildContextPack } from './context-pack.js';
import type { EmbeddingProvider, EmbeddingMeta } from './embedding-provider.js';
import { embeddingMetaKey } from './embedding-provider.js';

const DEFAULT_BUILD_CONCURRENCY = Number(process.env.RUBYNOD_INDEX_CONCURRENCY ?? 8);
const MAX_FILE_BYTES = 512_000;

export class CodebaseIndexer {
  private store: IndexStore;
  private workspaceRoot: string;
  private indexing = false;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private buildConcurrency = DEFAULT_BUILD_CONCURRENCY;
  private searchCandidateLimit = Number(process.env.RUBYNOD_SEARCH_CANDIDATES ?? 400);
  private embeddingProvider: EmbeddingProvider | null = null;
  private lastBuildDiagnostics = {
    filesDiscovered: 0,
    filesSkippedLarge: 0,
    filesSkippedEmpty: 0,
    filesSkippedError: 0,
  };

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.store = new IndexStore(this.workspaceRoot);
  }

  setEmbeddingProvider(provider: EmbeddingProvider | null): void {
    this.embeddingProvider = provider;
    this.store.setEmbeddingProvider(provider);
  }

  /**
   * Check if the stored embedding meta matches the current provider.
   * If not, a full rebuild is needed.
   */
  needsEmbeddingRebuild(): boolean {
    if (!this.embeddingProvider) return false;
    const raw = this.store.getMeta(embeddingMetaKey());
    if (!raw) return true;
    try {
      const meta = JSON.parse(raw) as EmbeddingMeta;
      return meta.provider !== this.embeddingProvider.name ||
        meta.model !== (this.embeddingProvider.name === 'ollama' ? (this.embeddingProvider as { model?: string }).model ?? '' : 'hash');
    } catch {
      return true;
    }
  }

  private saveEmbeddingMeta(): void {
    if (!this.embeddingProvider) return;
    const meta: EmbeddingMeta = {
      provider: this.embeddingProvider.name as EmbeddingMeta['provider'],
      model: this.embeddingProvider.name === 'ollama'
        ? ((this.embeddingProvider as unknown as { model?: string }).model ?? 'nomic-embed-text')
        : 'hash',
      dims: this.embeddingProvider.dims,
    };
    this.store.setMeta(embeddingMetaKey(), JSON.stringify(meta));
  }

  getStatus(): IndexStats {
    return {
      ...this.store.getStats(this.indexing),
      ...this.lastBuildDiagnostics,
    };
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
    this.lastBuildDiagnostics = {
      filesDiscovered: 0,
      filesSkippedLarge: 0,
      filesSkippedEmpty: 0,
      filesSkippedError: 0,
    };

    const files = walkWorkspace(this.workspaceRoot);
    this.lastBuildDiagnostics.filesDiscovered = files.length;

    onProgress?.({
      phase: 'scanning',
      filesTotal: files.length,
      filesDone: 0,
      message: `Found ${files.length} files to index`,
    });

    this.store.beginBatch();
    this.store.clear();
    let done = 0;
    const concurrency = Math.max(1, this.buildConcurrency);

    try {
      for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        const prepared = await Promise.all(batch.map((abs) => this.prepareFile(abs)));
        for (const item of prepared) {
          if (!item) continue;
          if (item.kind === 'skip-large') this.lastBuildDiagnostics.filesSkippedLarge++;
          else if (item.kind === 'skip-empty') this.lastBuildDiagnostics.filesSkippedEmpty++;
          else if (item.kind === 'error') this.lastBuildDiagnostics.filesSkippedError++;
          else if (item.kind === 'indexed') {
            this.store.removePath(item.rel);
            await this.store.upsertChunksWithEmbeddings(item.chunks);
            this.store.upsertFile(item.rel, item.mtimeMs, item.size);
          }
        }
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
      this.saveEmbeddingMeta();
    } finally {
      this.store.endBatch();
      this.indexing = false;
    }

    const stats = this.getStatus();
    onProgress?.({
      phase: 'done',
      filesTotal: files.length,
      filesDone: files.length,
      message: `Index ready — ${stats.chunkCount} chunks from ${stats.fileCount} files`,
    });

    return stats;
  }

  /** Read + chunk in parallel; DB writes happen serially in buildIndex. */
  private async prepareFile(
    abs: string
  ): Promise<
    | { kind: 'indexed'; rel: string; chunks: ReturnType<typeof chunkFileSmart>; mtimeMs: number; size: number }
    | { kind: 'skip-large' | 'skip-empty' | 'error' }
    | null
  > {
    const rel = path.relative(this.workspaceRoot, abs).replace(/\\/g, '/');
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_BYTES) return { kind: 'skip-large' };

      const prevMtime = this.store.getFileMtime(rel);
      if (prevMtime !== null && prevMtime === stat.mtimeMs) {
        return null;
      }

      const content = fs.readFileSync(abs, 'utf8');
      const chunks = chunkFileSmart(rel, content);
      if (!chunks.length) return { kind: 'skip-empty' };
      return { kind: 'indexed', rel, chunks, mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return { kind: 'error' };
    }
  }

  private async indexOneFile(abs: string): Promise<void> {
    const item = await this.prepareFile(abs);
    if (!item || item.kind !== 'indexed') return;
    this.store.removePath(item.rel);
    await this.store.upsertChunksWithEmbeddings(item.chunks);
    this.store.upsertFile(item.rel, item.mtimeMs, item.size);
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

  async searchAsync(query: string, limit?: number): Promise<SearchResult[]> {
    let queryEmbedding: number[] | undefined;
    if (this.embeddingProvider) {
      const emb = await this.embeddingProvider.embed(query);
      if (emb.length) queryEmbedding = emb;
    }
    return this.store.hybridSearch(query, limit ?? 12, this.searchCandidateLimit, queryEmbedding);
  }

  search(query: string, limit?: number): SearchResult[] {
    return this.store.hybridSearch(query, limit ?? 12, this.searchCandidateLimit);
  }

  /** Build ready-to-send context for the AI from the user query (async, uses real embeddings) */
  async getContextPackAsync(query: string, opts?: { limit?: number; maxChars?: number }): Promise<ContextPack> {
    const limit = opts?.limit ?? 10;
    const chunks = await this.searchAsync(query, limit);
    const symbols = this.store.searchSymbols(query, 12);
    return buildContextPack(query, chunks, symbols, { maxChars: opts?.maxChars });
  }

  /** Sync fallback — used when async path is not available */
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
