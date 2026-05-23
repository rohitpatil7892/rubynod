export { CodebaseIndexer } from './indexer.js';
export { initSqlEngine, isSqlEngineReady } from './sql-init.js';
export type {
  SearchResult,
  IndexProgress,
  IndexChunk,
  IndexSymbol,
  IndexStats,
  ContextPack,
} from './types.js';
export { buildContextPack } from './context-pack.js';
export { shouldIndex } from './ignore.js';
export type { EmbeddingProvider, EmbeddingMeta } from './embedding-provider.js';
export { HashEmbeddingProvider } from './hash-embedding.js';
export { OllamaEmbeddingProvider } from './ollama-embedding.js';
