import OpenAI from 'openai';
import type { ChatMessage } from './types.js';
import { formatOllamaNoToolsModelError } from './ollama.js';
import { agentLog } from './logger.js';

function ollamaToolsUnsupportedMessage(err: unknown): string | null {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'message' in err
        ? String((err as { message?: unknown }).message)
        : String(err);
  if (/does not support tools/i.test(msg)) return msg;
  return null;
}

export interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'openrouter';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export function resolveModelConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  const provider = (overrides?.provider ??
    process.env.RUBYNOD_PROVIDER ??
    'ollama') as ModelConfig['provider'];

  const defaults: Record<ModelConfig['provider'], { model: string; baseUrl?: string }> = {
    openai: { model: 'gpt-4o-mini' },
    anthropic: { model: 'claude-3-5-haiku-latest', baseUrl: 'https://api.anthropic.com/v1' },
    ollama: { model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434/v1' },
    openrouter: { model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
  };

  const d = defaults[provider];
  const modelRaw = overrides?.model ?? process.env.RUBYNOD_MODEL ?? d.model;
  const model = typeof modelRaw === 'string' ? modelRaw.trim() : d.model;
  return {
    provider,
    model: model || d.model,
    baseUrl: overrides?.baseUrl ?? process.env.RUBYNOD_BASE_URL ?? d.baseUrl,
    apiKey:
      overrides?.apiKey ??
      process.env.OPENAI_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      (provider === 'ollama' ? 'ollama' : undefined),
  };
}

export class ModelRouter {
  private client: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: ModelConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'missing',
      baseURL: config.baseUrl,
    });
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 8192;
  }

  async *streamChat(
    messages: ChatMessage[],
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
    opts?: { toolChoice?: 'auto' | 'required' | 'none' }
  ): AsyncGenerator<{
    type: 'text' | 'tool_calls';
    text?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  }> {
    const openaiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, tool_call_id: m.toolCallId!, content: m.content };
      }
      return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
    });

    const toolChoice =
      tools?.length && opts?.toolChoice && opts.toolChoice !== 'none' ? opts.toolChoice : undefined;

    const requestBody = {
      model: this.model,
      messages: openaiMessages,
      tools: tools?.length ? tools : undefined,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      stream: true as const,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };

    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await this.client.chat.completions.create(requestBody);
    } catch (err) {
      if (toolChoice === 'required' && ollamaToolsUnsupportedMessage(err)) {
        agentLog.warn('Model rejected tool_choice=required; retrying with auto', {
          model: this.model,
        });
        const { tool_choice: _removed, ...withoutRequired } = requestBody;
        try {
          stream = await this.client.chat.completions.create(withoutRequired);
        } catch (retryErr) {
          if (ollamaToolsUnsupportedMessage(retryErr)) {
            throw new Error(formatOllamaNoToolsModelError(this.model));
          }
          throw retryErr;
        }
      } else if (ollamaToolsUnsupportedMessage(err)) {
        throw new Error(formatOllamaNoToolsModelError(this.model));
      } else {
        throw err;
      }
    }

    if (toolChoice) {
      agentLog.debug('Chat completion tool_choice', { toolChoice });
    }

    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: 'text', text: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' };
          }
          if (tc.id) toolCalls[idx]!.id = tc.id;
          if (tc.function?.name) toolCalls[idx]!.name = tc.function.name;
          if (tc.function?.arguments) toolCalls[idx]!.arguments += tc.function.arguments;
        }
      }
    }

    if (toolCalls.length) {
      agentLog.debug('Model native tool_calls', {
        count: toolCalls.length,
        tools: toolCalls.map((t) => ({
          name: t.name,
          argsLen: t.arguments?.length ?? 0,
        })),
      });
      yield { type: 'tool_calls', toolCalls };
    }
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const openaiMessages = messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    });
    return res.choices[0]?.message?.content ?? '';
  }

  async fim(prefix: string, suffix: string): Promise<string> {
    if (!this.model?.trim()) {
      throw new Error('Tab completion model is not configured. Set rubynod.models.chatModel or rubynod.tab.model.');
    }
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'Complete the code at <CURSOR>. Output ONLY the insertion, no explanation.',
        },
        {
          role: 'user',
          content: `${prefix}<CURSOR>${suffix}`,
        },
      ],
      max_tokens: 256,
    });
    return res.choices[0]?.message?.content ?? '';
  }
}
