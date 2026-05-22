const DEFAULT_HOST = 'http://127.0.0.1:11434';

/** Names that are almost never tool-capable (base weights, embeddings). */
const LIKELY_NO_TOOLS_RE =
  /(?:^|:|-)(base|embed)(?:$|:|[-/])|(?:^|:|-)embed(?:$|:|[-/])|embeddings?/i;

const capabilityCache = new Map<string, { supportsTools: boolean; at: number }>();
const CAPABILITY_CACHE_MS = 5 * 60 * 1000;

export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
  /** From Ollama /api/show capabilities; false = not usable for Agent tool calling */
  supportsTools?: boolean;
}

export function ollamaHostFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return DEFAULT_HOST;
  return baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

export function likelyOllamaModelWithoutTools(name: string): boolean {
  return LIKELY_NO_TOOLS_RE.test(name);
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

export async function ollamaModelSupportsTools(
  name: string,
  host = DEFAULT_HOST
): Promise<boolean> {
  const key = `${host}::${name}`;
  const cached = capabilityCache.get(key);
  if (cached && Date.now() - cached.at < CAPABILITY_CACHE_MS) {
    return cached.supportsTools;
  }

  if (likelyOllamaModelWithoutTools(name)) {
    capabilityCache.set(key, { supportsTools: false, at: Date.now() });
    return false;
  }

  try {
    const res = await fetch(`${host}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const supportsTools = !likelyOllamaModelWithoutTools(name);
      capabilityCache.set(key, { supportsTools, at: Date.now() });
      return supportsTools;
    }
    const data = (await res.json()) as { capabilities?: string[] };
    const caps = data.capabilities;
    const supportsTools = Array.isArray(caps) ? caps.includes('tools') : !likelyOllamaModelWithoutTools(name);
    capabilityCache.set(key, { supportsTools, at: Date.now() });
    return supportsTools;
  } catch {
    const supportsTools = !likelyOllamaModelWithoutTools(name);
    capabilityCache.set(key, { supportsTools, at: Date.now() });
    return supportsTools;
  }
}

/** Annotate each installed model with supportsTools (parallel, capped). */
export async function listOllamaModelsWithCapabilities(host = DEFAULT_HOST): Promise<OllamaModel[]> {
  const models = await listOllamaModels(host);
  const concurrency = 4;
  const out: OllamaModel[] = new Array(models.length);
  let i = 0;
  async function worker() {
    while (i < models.length) {
      const idx = i++;
      const m = models[idx]!;
      const supportsTools = await ollamaModelSupportsTools(m.name, host);
      out[idx] = { ...m, supportsTools };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, () => worker()));
  return out;
}

/** Prefer coding-friendly models that support Agent tools */
export function pickDefaultOllamaModel(models: OllamaModel[]): string | null {
  if (!models.length) return null;
  const toolCapable = models.filter((m) => m.supportsTools !== false);
  const pool = toolCapable.length ? toolCapable : models;
  const names = pool.map((m) => m.name);
  const preferred = [
    'qwen2.5-coder:7b',
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

export function formatOllamaNoToolsModelError(model: string): string {
  return (
    `Model "${model}" does not support tool calling, so Rubynod Agent cannot edit or search your project with it.\n\n` +
    `This often happens with *-base (pretrained weights), embedding, or very small models pulled from the registry.\n\n` +
    `Install a chat model with tools, then pick it in the model dropdown:\n` +
    `  ollama pull qwen2.5-coder:7b\n` +
    `  ollama pull llama3.2\n\n` +
    `In the picker, models marked "(no agent tools)" are chat-only — use them for Ask, not Agent.`
  );
}
