import {
  CHAT_PROVIDERS,
  cloudModelsForProvider,
  type ChatProviderId,
} from './model-catalog';
import { labelOllamaModelForPicker, listOllamaModelsForChat } from './ollama-models';
import { getModel, getProvider } from './settings';

export type ResolvedChatModels = {
  provider: ChatProviderId;
  models: string[];
  modelLabels?: Record<string, string>;
  /** Models that lack tool-calling support. */
  noToolModels?: string[];
  current: string;
  error?: string;
};

/** Resolve model list for the composer (Ollama via Rubynod service or cloud presets). */
export async function resolveChatModelsForProvider(
  requestedProvider?: string,
  timeoutMs = 15_000
): Promise<ResolvedChatModels> {
  const provider = (requestedProvider || getProvider()) as ChatProviderId;
  const configured = getModel();
  let models: string[] = [];
  let modelLabels: Record<string, string> | undefined;
  let noToolModels: string[] = [];
  let picked = configured;
  let error: string | undefined;

  if (provider === 'ollama') {
    const ollama = await Promise.race([
      listOllamaModelsForChat(),
      new Promise<Awaited<ReturnType<typeof listOllamaModelsForChat>>>((resolve) =>
        setTimeout(
          () =>
            resolve({
              models: [],
              error: 'Loading models timed out — check Ollama (ollama serve) and reload the window.',
            }),
          timeoutMs
        )
      ),
    ]);
    models = ollama.models.map((m) => m.name);
    modelLabels = Object.fromEntries(
      ollama.models.map((m) => [m.name, labelOllamaModelForPicker(m)])
    );
    noToolModels = ollama.models.filter((m) => m.supportsTools === false).map((m) => m.name);
    error = ollama.error;
    const suggested = ollama.suggested;
    const currentEntry = ollama.models.find((m) => m.name === configured);
    if (currentEntry?.supportsTools === false && suggested && models.includes(suggested)) {
      picked = suggested;
    } else {
      picked = models.includes(configured)
        ? configured
        : suggested && models.includes(suggested)
          ? suggested
          : (models[0] ?? configured);
    }
    if (picked && models.length && !models.includes(picked)) {
      models = [picked, ...models];
      modelLabels[picked] = labelOllamaModelForPicker({
        name: picked,
        supportsTools: ollama.models.find((m) => m.name === picked)?.supportsTools,
      });
    }
  } else {
    models = cloudModelsForProvider(provider, configured);
    picked = models.includes(configured) ? configured : (models[0] ?? configured);
  }

  return { provider, models, modelLabels, noToolModels, current: picked, error };
}

export { CHAT_PROVIDERS };
