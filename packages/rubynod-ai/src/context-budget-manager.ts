/**
 * Model-aware context token budget manager.
 *
 * Allocates character budget across context categories and truncates lowest-scored
 * chunks first so the total stays within the model's practical context window.
 */
import type { ContextAttachment } from './types.js';

export interface BudgetConfig {
  /** Model name — used to guess context window size. */
  model: string;
  /** Hard character override (optional; if not set, derived from model). */
  totalCharOverride?: number;
}

/** Approximate chars per token (conservative: 3 chars/token). */
const CHARS_PER_TOKEN = 3;

/** Heuristic context window sizes by model name pattern (in tokens). */
const MODEL_CONTEXT_WINDOWS: Array<{ pattern: RegExp; tokens: number }> = [
  { pattern: /128k|131072/i, tokens: 128_000 },
  { pattern: /64k|65536/i, tokens: 64_000 },
  { pattern: /32k|qwen2\.5|gemma3|mistral|llama3|phi4/i, tokens: 32_000 },
  { pattern: /16k/i, tokens: 16_000 },
  { pattern: /\b(3b|2b|1b)\b/i, tokens: 8_000 },
];

const DEFAULT_CONTEXT_TOKENS = 32_000;

/** Reserve fraction for system prompt + chat history. */
const SYSTEM_FRACTION = 0.15;
const WORKSPACE_FRACTION = 0.20;
const RETRIEVAL_FRACTION = 0.25;
const CHAT_FRACTION = 0.20;
const RESERVE_FRACTION = 0.10;
// Remaining 10% goes to diagnostics / git / misc

type BucketName = 'system' | 'workspace' | 'retrieval' | 'chat' | 'reserve' | 'misc';

export interface ContextBudget {
  totalChars: number;
  buckets: Record<BucketName, number>;
}

function detectContextWindow(model: string): number {
  for (const { pattern, tokens } of MODEL_CONTEXT_WINDOWS) {
    if (pattern.test(model)) return tokens;
  }
  return DEFAULT_CONTEXT_TOKENS;
}

export function computeBudget(cfg: BudgetConfig): ContextBudget {
  const totalTokens = detectContextWindow(cfg.model);
  const totalChars = cfg.totalCharOverride ?? totalTokens * CHARS_PER_TOKEN;
  return {
    totalChars,
    buckets: {
      system: Math.floor(totalChars * SYSTEM_FRACTION),
      workspace: Math.floor(totalChars * WORKSPACE_FRACTION),
      retrieval: Math.floor(totalChars * RETRIEVAL_FRACTION),
      chat: Math.floor(totalChars * CHAT_FRACTION),
      reserve: Math.floor(totalChars * RESERVE_FRACTION),
      misc: Math.floor(totalChars * (1 - SYSTEM_FRACTION - WORKSPACE_FRACTION - RETRIEVAL_FRACTION - CHAT_FRACTION - RESERVE_FRACTION)),
    },
  };
}

function attachmentBucket(att: ContextAttachment): BucketName {
  switch (att.type) {
    case 'rules': return 'workspace';
    case 'codebase': return 'retrieval';
    case 'symbols': return 'retrieval';
    case 'file':
    case 'folder':
    case 'open': return 'workspace';
    case 'diagnostics': return 'misc';
    case 'git': return 'misc';
    default: return 'misc';
  }
}

/**
 * Truncate attachments so total char usage stays within budget for the relevant buckets.
 * Manual attachments are kept whole; auto attachments are dropped (lowest-scored first,
 * by position in array — ranker already sorted them).
 */
export function applyBudget(
  attachments: ContextAttachment[],
  manualCount: number,
  budget: ContextBudget
): ContextAttachment[] {
  // Calculate per-bucket remaining capacity
  const used: Record<BucketName, number> = { system: 0, workspace: 0, retrieval: 0, chat: 0, reserve: 0, misc: 0 };

  const result: ContextAttachment[] = [];

  // Always include manual attachments; they are user-explicit
  for (const att of attachments.slice(0, manualCount)) {
    result.push(att);
    const bucket = attachmentBucket(att);
    used[bucket] += att.content?.length ?? 0;
  }

  // Auto attachments: include while bucket has room; skip if over budget
  for (const att of attachments.slice(manualCount)) {
    const bucket = attachmentBucket(att);
    const size = att.content?.length ?? 0;
    if (used[bucket] + size <= budget.buckets[bucket]) {
      result.push(att);
      used[bucket] += size;
    }
    // else: drop this attachment (already ranked, so we're dropping lowest-priority)
  }

  return result;
}
