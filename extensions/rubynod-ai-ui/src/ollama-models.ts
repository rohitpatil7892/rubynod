import { getOllamaHost, getServiceUrl } from './settings';

const FETCH_TIMEOUT_MS = 10_000;

export type OllamaChatModel = {
  name: string;
  supportsTools?: boolean;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** List Ollama models via Rubynod AI service, with direct Ollama fallback. */
export async function listOllamaModelsForChat(): Promise<{
  models: OllamaChatModel[];
  suggested?: string;
  error?: string;
}> {
  const host = getOllamaHost();

  try {
    const json = await fetchJson<{
      ok?: boolean;
      models?: Array<{ name: string; supportsTools?: boolean }>;
      suggested?: string;
      error?: string;
    }>(`${getServiceUrl()}/ollama/models?host=${encodeURIComponent(host)}`);
    if (json.ok === false) {
      return { models: [], error: json.error ?? 'Ollama unreachable' };
    }
    const models = (json.models ?? [])
      .map((m) => ({ name: m.name, supportsTools: m.supportsTools }))
      .filter((m) => m.name);
    if (models.length) {
      return { models, suggested: json.suggested ?? models[0]?.name };
    }
  } catch {
    // try direct Ollama
  }

  try {
    const data = await fetchJson<{ models?: Array<{ name: string }> }>(`${host}/api/tags`);
    const models = (data.models ?? []).map((m) => ({ name: m.name })).filter((m) => m.name);
    if (models.length) {
      return { models, suggested: models[0]?.name };
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

export function labelOllamaModelForPicker(m: OllamaChatModel): string {
  if (m.supportsTools === false) return `${m.name} (no agent tools)`;
  return m.name;
}
