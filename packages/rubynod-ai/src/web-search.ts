/** Lightweight web search via DuckDuckGo Instant Answer (no API key). */
export async function webSearch(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return `Web search failed: HTTP ${res.status}`;
  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const parts: string[] = [];
  if (data.AbstractText) {
    parts.push(`## ${data.Heading ?? query}\n${data.AbstractText}`);
    if (data.AbstractURL) parts.push(`Source: ${data.AbstractURL}`);
  }
  const topics = (data.RelatedTopics ?? []).filter((t) => t.Text).slice(0, 6);
  if (topics.length) {
    parts.push(
      '## Related\n' + topics.map((t) => `- ${t.Text}${t.FirstURL ? ` (${t.FirstURL})` : ''}`).join('\n')
    );
  }
  return parts.length ? parts.join('\n\n') : '(no web results — try a more specific query)';
}
