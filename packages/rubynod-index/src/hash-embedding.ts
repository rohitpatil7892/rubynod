import type { EmbeddingProvider } from './embedding-provider.js';
import { embedText, cosineSimilarity } from './embeddings.js';

export { cosineSimilarity };

/** Local bag-of-words hash embedding — zero dependencies, works offline. */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hash';
  readonly dims = 256;

  async embed(text: string): Promise<number[]> {
    return embedText(text, this.dims);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => embedText(t, this.dims));
  }
}
