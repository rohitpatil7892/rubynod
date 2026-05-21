import { getOllamaHost, getServiceUrl } from './settings';

const FETCH_TIMEOUT_MS = 10_000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** List Ollama models via Rubynod AI service, with direct Ollama fallback. */
export async function listOllamaModelsForChat(): Promise<{
  models: string[];
  suggested?: string;
  error?: string;
}> {
  const host = getOllamaHost();

  try {
    const json = await fetchJson<{
      ok?: boolean;
      models?: Array<{ name: string }>;
      suggested?: string;
      error?: string;
    }>(`${getServiceUrl()}/ollama/models?host=${encodeURIComponent(host)}`);
    if (json.ok === false) {
      return { models: [], error: json.error ?? 'Ollama unreachable' };
    }
    const models = (json.models ?? []).map((m) => m.name).filter(Boolean);
    if (models.length) {
      return { models, suggested: json.suggested ?? models[0] };
    }
  } catch {
    // try direct Ollama
  }

  try {
    const data = await fetchJson<{ models?: Array<{ name: string }> }>(`${host}/api/tags`);
    const models = (data.models ?? []).map((m) => m.name).filter(Boolean);
    if (models.length) {
      return { models, suggested: models[0] };
    }
    return {
      models: [],
      error: 'Ollama is running but no models are installed. Run: ollama pull llama3.2',
    };
  } catch {
    return {
      models: [],
      error: `Cannot reach Ollama at ${host}. Run: ollama serve`,
    };
  }
}
