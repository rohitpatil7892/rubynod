const DEFAULT_HOST = 'http://127.0.0.1:11434';

export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

export function ollamaHostFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return DEFAULT_HOST;
  return baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

export async function checkOllamaHealth(host = DEFAULT_HOST): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(host = DEFAULT_HOST): Promise<OllamaModel[]> {
  const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama not reachable at ${host} (${res.status})`);
  const data = (await res.json()) as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
  return (data.models ?? []).map((m) => ({
    name: m.name,
    size: m.size,
    modified_at: m.modified_at,
  }));
}

/** Prefer coding-friendly models when auto-selecting */
export function pickDefaultOllamaModel(models: OllamaModel[]): string | null {
  if (!models.length) return null;
  const names = models.map((m) => m.name);
  const preferred = [
    'qwen2.5-coder',
    'deepseek-coder',
    'codellama',
    'llama3.2',
    'llama3.1',
    'mistral',
    'phi3',
  ];
  for (const p of preferred) {
    const hit = names.find((n) => n === p || n.startsWith(`${p}:`));
    if (hit) return hit;
  }
  return names[0] ?? null;
}
