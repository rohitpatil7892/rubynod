/**
 * Intent-based context ranker. Scores and reorders candidate ContextAttachments
 * before the token budget truncation in buildContextBundle.
 */
import type { ContextAttachment } from './types.js';

const ERROR_KEYWORDS = /\b(error|exception|crash|fail|undefined|null pointer|traceback|stacktrace|cannot find|not found|type error)\b/i;
const REFACTOR_KEYWORDS = /\b(refactor|rename|extract|move|reorganize|clean up|simplify)\b/i;
const TEST_KEYWORDS = /\b(test|spec|jest|vitest|assert|coverage|unit test|integration)\b/i;
const SYMBOL_RE = /\b([A-Z][a-zA-Z0-9]{2,}|[a-z][a-zA-Z0-9]*(?:Service|Manager|Handler|Controller|Router|Store|Hook|Provider|Context|Util|Helper))\b/g;

function extractSymbolsFromQuery(query: string): Set<string> {
  const matches = query.match(SYMBOL_RE) ?? [];
  return new Set(matches.map((m) => m.toLowerCase()));
}

type Intent = 'error' | 'refactor' | 'test' | 'symbol' | 'general';

function detectIntent(query: string): Intent {
  if (ERROR_KEYWORDS.test(query)) return 'error';
  if (REFACTOR_KEYWORDS.test(query)) return 'refactor';
  if (TEST_KEYWORDS.test(query)) return 'test';
  if (/\b[A-Z][a-zA-Z0-9]{2,}\b/.test(query)) return 'symbol';
  return 'general';
}

function typeWeight(type: string, intent: Intent): number {
  switch (intent) {
    case 'error':
      if (type === 'diagnostics') return 2.0;
      if (type === 'file') return 1.4;
      if (type === 'terminal') return 1.3;
      break;
    case 'refactor':
      if (type === 'symbols') return 1.8;
      if (type === 'codebase') return 1.5;
      if (type === 'file') return 1.3;
      break;
    case 'test':
      if (type === 'file') return 1.5;
      if (type === 'codebase') return 1.3;
      break;
    case 'symbol':
      if (type === 'symbols') return 2.0;
      if (type === 'codebase') return 1.4;
      break;
    default:
      break;
  }
  return 1.0;
}

function symbolOverlapBonus(att: ContextAttachment, querySymbols: Set<string>): number {
  if (!querySymbols.size) return 0;
  const content = `${att.label} ${att.path ?? ''} ${att.content ?? ''}`.toLowerCase();
  let hits = 0;
  for (const sym of querySymbols) {
    if (content.includes(sym)) hits++;
  }
  return hits * 0.25;
}

/**
 * Rank attachments by intent signals. Manual attachments (user explicit) are always
 * kept first. The returned array preserves manual order then sorts the rest.
 */
export function rankAttachments(
  attachments: ContextAttachment[],
  query: string,
  manualCount: number
): ContextAttachment[] {
  if (attachments.length <= 1) return attachments;

  const intent = detectIntent(query);
  const querySymbols = extractSymbolsFromQuery(query);

  const manual = attachments.slice(0, manualCount);
  const auto = attachments.slice(manualCount);

  const scored = auto.map((att) => {
    const base = typeWeight(att.type, intent);
    const bonus = symbolOverlapBonus(att, querySymbols);
    return { att, score: base + bonus };
  });

  scored.sort((a, b) => b.score - a.score);
  return [...manual, ...scored.map((s) => s.att)];
}
