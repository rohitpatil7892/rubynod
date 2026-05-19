export interface IndexChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  embedding?: number[];
  symbolName?: string;
  symbolKind?: string;
}

export interface IndexSymbol {
  path: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  container?: string;
}

export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  matchType: 'semantic' | 'text' | 'symbol';
}

export interface IndexProgress {
  phase: 'scanning' | 'chunking' | 'embedding' | 'indexing' | 'done' | 'idle';
  filesTotal: number;
  filesDone: number;
  message: string;
}

export interface IndexStats {
  chunkCount: number;
  fileCount: number;
  symbolCount: number;
  lastIndexedAt: string | null;
  indexing: boolean;
}

export interface ContextPack {
  query: string;
  chunks: SearchResult[];
  symbols: IndexSymbol[];
  summary: string;
  formatted: string;
}
