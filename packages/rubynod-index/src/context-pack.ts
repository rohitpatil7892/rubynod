import type { ContextPack, IndexSymbol, SearchResult } from './types.js';

export function buildContextPack(
  query: string,
  chunks: SearchResult[],
  symbols: IndexSymbol[],
  opts?: { maxChars?: number }
): ContextPack {
  const maxChars = opts?.maxChars ?? 32_000;
  const parts: string[] = [];
  parts.push(`# Codebase context for: "${query}"\n`);

  if (symbols.length) {
    parts.push(`## Relevant symbols\n`);
    for (const s of symbols.slice(0, 15)) {
      parts.push(`- **${s.kind}** \`${s.name}\` — ${s.path}:${s.startLine}`);
    }
    parts.push('');
  }

  parts.push(`## Code snippets\n`);
  let used = parts.join('\n').length;
  const included: SearchResult[] = [];

  for (const c of chunks) {
    const block = formatChunk(c);
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
    included.push(c);
  }

  const summary = `${included.length} chunks, ${symbols.length} symbols (from index)`;
  return {
    query,
    chunks: included,
    symbols,
    summary,
    formatted: parts.join('\n'),
  };
}

function formatChunk(c: SearchResult): string {
  const ext = c.path.split('.').pop() ?? 'txt';
  return `### ${c.path}:${c.startLine}-${c.endLine} (score ${c.score.toFixed(2)})\n\`\`\`${ext}\n${c.content}\n\`\`\`\n`;
}
