/** Provider and model presets for the chat composer picker. */

export type ChatProviderId = 'ollama' | 'openai' | 'anthropic' | 'openrouter';

export const CHAT_PROVIDERS: Array<{ id: ChatProviderId; label: string }> = [
  { id: 'ollama', label: 'Ollama' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openrouter', label: 'OpenRouter' },
];

export const CLOUD_CHAT_MODELS: Record<Exclude<ChatProviderId, 'ollama'>, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'o1-mini', 'o1-preview'],
  anthropic: [
    'claude-3-5-haiku-latest',
    'claude-3-5-sonnet-latest',
    'claude-3-opus-20240229',
  ],
  openrouter: [
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-haiku',
    'google/gemini-flash-1.5',
    'meta-llama/llama-3.2-3b-instruct:free',
  ],
};

export function defaultBaseUrlForProvider(provider: ChatProviderId): string {
  switch (provider) {
    case 'ollama':
      return 'http://127.0.0.1:11434/v1';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    default:
      return 'http://127.0.0.1:11434/v1';
  }
}

export function cloudModelsForProvider(provider: string, currentModel?: string): string[] {
  const list = CLOUD_CHAT_MODELS[provider as keyof typeof CLOUD_CHAT_MODELS];
  if (!list) return currentModel ? [currentModel] : [];
  if (currentModel && !list.includes(currentModel)) {
    return [currentModel, ...list];
  }
  return [...list];
}
