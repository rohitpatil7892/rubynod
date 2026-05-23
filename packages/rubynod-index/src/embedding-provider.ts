/** Common interface for all embedding backends. */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dims: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[], batchSize?: number): Promise<number[][]>;
}

/** Embedding config stored in index meta to detect provider/model changes. */
export interface EmbeddingMeta {
  provider: 'hash' | 'ollama';
  model: string;
  dims: number;
}

export function embeddingMetaKey(): string {
  return 'embeddingMeta';
}
