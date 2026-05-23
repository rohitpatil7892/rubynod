import type { EmbeddingProvider } from './embedding-provider.js';

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_DIMS = 768;

let loggedFallback = false;

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dims: number;
  private readonly model: string;
  private readonly host: string;

  constructor(model = DEFAULT_MODEL, host = DEFAULT_OLLAMA_HOST, dims = DEFAULT_DIMS) {
    this.model = model;
    this.host = host.replace(/\/$/, '');
    this.dims = dims;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const res = await fetch(`${this.host}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
      const data = (await res.json()) as { embedding?: number[] };
      if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
        throw new Error('Empty embedding response');
      }
      return data.embedding;
    } catch (err) {
      if (!loggedFallback) {
        loggedFallback = true;
        console.warn(`[rubynod-index] Ollama embedding failed (${err instanceof Error ? err.message : String(err)}); falling back to hash embedding for this session.`);
      }
      return [];
    }
  }

  async embedBatch(texts: string[], batchSize = 8): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map((t) => this.embed(t)));
      results.push(...embeddings);
    }
    return results;
  }

  /** Check connectivity and model availability. */
  static async isAvailable(model = DEFAULT_MODEL, host = DEFAULT_OLLAMA_HOST): Promise<boolean> {
    try {
      const res = await fetch(`${host.replace(/\/$/, '')}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
