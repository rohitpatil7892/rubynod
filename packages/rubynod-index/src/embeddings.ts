/** Simple bag-of-words embedding for local hybrid search (no API required). */
export function embedText(text: string, dims = 256): number[] {
  const vec = new Array(dims).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const tok of tokens) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) {
      h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    }
    const idx = h % dims;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i]! * b[i]!;
  return dot;
}
