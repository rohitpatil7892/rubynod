/**
 * Build a unified ContextBundle per agent turn that merges:
 * 1. Manual @file / chip attachments (highest priority)
 * 2. Active file + diagnostics (auto, "coding" mode)
 * 3. Auto @codebase retrieved chunks (hybrid search)
 * 4. Git context
 *
 * All sources are capped by the configured char budget.
 */
import type { ContextAttachment } from './types.js';
import type { CodebaseIndexer } from '@rubynod/index';
import { getCachedContextPack, setCachedContextPack } from './context-cache.js';
import { rankAttachments } from './context-ranker.js';
import { computeBudget, applyBudget } from './context-budget-manager.js';

export interface ContextBundleOptions {
  message: string;
  manualAttachments: ContextAttachment[];
  workspaceRoot: string;
  indexer: CodebaseIndexer | null;
  /** 'coding' = active file + diagnostics + auto index | 'minimal' = auto index only | 'off' = none */
  autoContextMode: 'coding' | 'minimal' | 'off';
  maxAutoContextChunks: number;
  maxAutoContextChars: number;
  contextCacheTtlSec: number;
  /** Called to retrieve active file + diagnostics from the IDE */
  getBridgeActiveContext?: () => Promise<ContextAttachment[]>;
  /** LLM model name — used for budget calculation */
  model?: string;
}

export async function buildContextBundle(opts: ContextBundleOptions): Promise<ContextAttachment[]> {
  const result: ContextAttachment[] = [];
  let budget = opts.maxAutoContextChars;

  // 1. Manual attachments always go first (user-explicit)
  for (const a of opts.manualAttachments) {
    result.push(a);
    budget -= (a.content?.length ?? 0);
  }

  if (opts.autoContextMode === 'off' || budget <= 0) {
    return result;
  }

  // 2. Bridge-supplied active file + diagnostics (coding mode)
  if (opts.autoContextMode === 'coding' && opts.getBridgeActiveContext) {
    try {
      const bridgeCtx = await opts.getBridgeActiveContext();
      for (const a of bridgeCtx) {
        if (budget <= 0) break;
        result.push(a);
        budget -= (a.content?.length ?? 0);
      }
    } catch {
      // Bridge may not be available — skip silently
    }
  }

  // 3. Auto @codebase from hybrid search (minimal + coding both get this)
  if (opts.indexer?.isReady() && opts.message.trim().length > 3) {
    const cacheTtl = opts.contextCacheTtlSec;
    let pack = getCachedContextPack(opts.workspaceRoot, opts.message, cacheTtl);
    if (!pack) {
      pack = await opts.indexer.getContextPackAsync(opts.message, {
        limit: opts.maxAutoContextChunks,
        maxChars: Math.min(budget, opts.maxAutoContextChars),
      });
      if (pack?.chunks.length) {
        setCachedContextPack(opts.workspaceRoot, opts.message, pack, cacheTtl);
      }
    }
    if (pack?.chunks.length) {
      result.push({
        type: 'codebase',
        label: `@codebase (auto): ${pack.summary}`,
        content: pack.formatted,
      });
      budget -= pack.formatted.length;
    }
  }

  // Rank auto attachments by intent, keeping manual first
  const ranked = rankAttachments(result, opts.message, opts.manualAttachments.length);

  // Apply model-aware budget truncation to drop lowest-priority chunks first
  const modelBudget = computeBudget({ model: opts.model ?? '' });
  return applyBudget(ranked, opts.manualAttachments.length, modelBudget);
}
