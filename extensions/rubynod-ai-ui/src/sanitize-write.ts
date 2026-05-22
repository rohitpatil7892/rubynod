/**
 * IDE-side write validation (bundled in the VSIX — no @rubynod/ai import).
 * Keep in sync with packages/rubynod-ai/src/sanitize-code.ts (core rules).
 */

function normalizeToolFilePath(filePath: string): string {
  let p = filePath.trim().replace(/\\/g, '/');
  while (p.startsWith('@')) p = p.slice(1);
  return p;
}

function looksLikePlaceholderStub(contents: string): boolean {
  const c = contents.trim();
  if (!c) return true;
  if (/placeholder|implement your logic here|you can implement|TODO:\s*implement/i.test(c)) {
    return true;
  }
  const substantive = c.split('\n').filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/^\/\//.test(t) || /^\/\*/.test(t) || /^\*\//.test(t) || /^\*/.test(t)) return false;
    return true;
  });
  if (substantive.length === 0) return true;
  if (substantive.length <= 2 && c.length < 200) {
    const onlyNoise = substantive.every((t) => /^[\}\]"'`;,\s]+$/.test(t));
    if (onlyNoise) return true;
  }
  return false;
}

function stripBrokenJsonTail(contents: string): string {
  let s = contents.trim();
  for (let pass = 0; pass < 8; pass++) {
    const before = s;
    s = s.replace(/["'`]+\s*$/g, '');
    s = s.replace(/,\s*"file"\s*:\s*"[^"]*"\s*\}\s*\}\s*$/g, '');
    s = s.replace(/"\s*\}\s*\}\s*$/g, '');
    s = s.replace(/\}\s*\}\s*[`']*\s*$/g, '');
    s = s.replace(/;\s*"\s*$/g, ';');
    const lines = s.split('\n');
    while (lines.length > 0 && /^[\s\}\]"'`]+$/.test(lines[lines.length - 1] ?? '')) {
      lines.pop();
    }
    s = lines.join('\n').trim();
    if (s === before) break;
  }
  return s;
}

function countRegexMatches(re: RegExp, text: string): number {
  return (text.match(re) ?? []).length;
}

function looksLikeToolCallJsonLeak(contents: string): boolean {
  const c = contents.trim();
  if (/^\{\s*"name"\s*:\s*"(?:write_file|read_file|search_replace|glob|grep)"/m.test(c)) return true;
  if (/"name"\s*:\s*"(?:write_file|read_file|search_replace)"[\s\S]*"arguments"\s*:\s*\{/.test(c)) {
    return true;
  }
  if (/```json\s*\n\s*\{[\s\S]*"name"\s*:\s*"/m.test(c)) return true;
  return false;
}

function tutorialProseScore(contents: string): number {
  const c = contents.trim();
  if (!c) return 0;
  let score = 0;
  const numberedSteps = countRegexMatches(/(?:^|\n)\s*\d+\.\s+\S/gim, c);
  if (numberedSteps >= 2) score += 3;
  else if (numberedSteps === 1) score += 1;
  if (countRegexMatches(/(?:^|\n)#{1,3}\s+\S/gim, c) >= 1) score += 2;
  const instructional = countRegexMatches(
    /\b(?:you can|let's|we'll|follow these steps|here(?:'s| is) how)\b/gim,
    c
  );
  if (instructional >= 2) score += 2;
  else if (instructional === 1) score += 1;
  if (/^(?:to\s+)?(?:add|create|implement|set up|build|generate)\s+/im.test(c)) score += 2;
  const lines = c.split('\n').filter((l) => l.trim());
  const codeLike = lines.filter((l) => /^\s*(?:import|export|class|function|const|@Injectable)\b/.test(l)).length;
  if (lines.length >= 4 && codeLike === 0 && c.length > 100) score += 3;
  if (/\blet's start\b/i.test(c) && !/\b(?:import|export|class|function)\b/.test(c)) score += 2;
  return score;
}

function looksLikeTutorialOrToolLeak(contents: string): boolean {
  return looksLikeToolCallJsonLeak(contents) || tutorialProseScore(contents) >= 4;
}

function validateWriteContents(contents: string, relPath: string): string | null {
  const c = contents.trim();
  if (!c) return 'empty contents';
  if (looksLikeTutorialOrToolLeak(c)) {
    return 'contents are chat/tutorial text or leaked tool JSON';
  }
  if (looksLikePlaceholderStub(c)) {
    return 'contents are placeholder comments only — write a complete implementation';
  }
  if (
    /\}\s*\}\s*[`'"]*\s*$/m.test(c) &&
    !/\bexport\s+(?:default\s+)?(?:class|function|const|interface|type)\b/.test(c) &&
    !/\bmodule\.exports\b/.test(c)
  ) {
    return 'contents end with broken JSON/tool braces (}})';
  }
  if (/\.service\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) {
    const substantive = c.split('\n').filter((line) => {
      const t = line.trim();
      return t && !/^\/\//.test(t) && !/^\/\*/.test(t) && !/^\*/.test(t);
    });
    if (substantive.length < 5) {
      return 'service file is too short — include real TypeScript/JavaScript, not comments only';
    }
  }
  if (/^\{\s*"(?:import|export|const|let|var|require|def\s)/m.test(c)) {
    return 'contents look like broken JSON-wrapped code';
  }
  if (/^\{\s*"name"\s*:\s*"(?:write_file|search_replace)"/.test(c)) {
    return 'contents are a tool-call JSON blob, not file source';
  }
  const ext = relPath.replace(/^@+/, '').split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext) && /^\s*def\s+\w+\s*\(/m.test(c)) {
    return 'Python syntax in a JavaScript/TypeScript file';
  }
  return null;
}

function unescapeLiteralEscapes(contents: string): string {
  if (!contents.includes('\\n')) return contents;
  const realNewlines = (contents.match(/\n/g) ?? []).length;
  const escapedNewlines = (contents.match(/\\n/g) ?? []).length;
  if (escapedNewlines > 0 && realNewlines < escapedNewlines / 2) {
    return contents
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"');
  }
  return contents;
}

function stripTrailingToolJsonGarbage(contents: string): string {
  let s = contents.trim();
  s = s.replace(/",\s*"file"\s*:\s*"[^"]*"\s*\}\}\s*$/g, '');
  s = s.replace(/"\}\}\s*$/g, '');
  s = s.replace(/\}\}\s*$/g, '');
  return stripBrokenJsonTail(s);
}

function sanitizeFileContents(contents: string): string {
  let s = contents.replace(/^\uFEFF/, '').trim();
  s = unescapeLiteralEscapes(s);
  s = stripTrailingToolJsonGarbage(s);

  const fence = /^```[\w#+.-]*\s*\n([\s\S]*?)```\s*$/;
  const fenced = s.match(fence);
  if (fenced) s = fenced[1]!.trim();

  s = s.replace(/^<script[^>]*>\s*/i, '').replace(/\s*<\/script>\s*$/i, '');

  const lines = s.split('\n');
  while (lines.length > 0 && /^\s*<\/?script\b[^>]*>\s*$/i.test(lines[0]!)) {
    lines.shift();
  }
  while (lines.length > 0 && /^\s*<\/script>\s*$/i.test(lines[lines.length - 1]!)) {
    lines.pop();
  }

  s = lines.join('\n').trim();

  if (/^<!DOCTYPE\s/i.test(s) || /^<html[\s>]/i.test(s)) {
    const scriptBody = s.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptBody) s = scriptBody[1]!.trim();
  }

  s = s.replace(/(database\s*:\s*['"][^'"]+['"])\s*;(\s*[\r\n]+\s*\})/g, '$1,$2');

  if (/^\{\s*"(?:import|export|const|let|var|require)\s/.test(s)) {
    s = s.replace(/^\{\s*/, '');
  }

  const tutorialCut = s.search(
    /\n(?:```\s*\n)?#{2,3}\s+Step\s+\d|\n\}\s*\n```\s*\n[\s\S]{0,200}#{2,3}\s+Step|\n```\s*\n\s*\{[\s\S]{0,400}"name"\s*:\s*"read_file"/m
  );
  if (tutorialCut > 40) s = s.slice(0, tutorialCut).trim();

  s = s.replace(/\s*"\s*\n\s*\}\s*\n\}\s*```[\s\S]*$/m, '');
  s = s.replace(/\s*;\s*"\s*\n\s*\}\s*\}\s*```[\s\S]*$/m, ';');

  return s.trim();
}

/** Validate and clean content before writing to disk. */
export function sanitizeWriteContent(content: string, relPath = 'file.txt'): string {
  const p = normalizeToolFilePath(relPath);
  let s = sanitizeFileContents(content);
  if (looksLikeTutorialOrToolLeak(s)) {
    throw new Error('refused: tutorial or tool JSON in file contents');
  }
  if (looksLikePlaceholderStub(s)) {
    throw new Error('refused: placeholder comments only — not real source code');
  }
  const invalid = validateWriteContents(s, p);
  if (invalid) {
    throw new Error(`refused: ${invalid}`);
  }
  if (!s.trim()) {
    throw new Error('refused: empty contents');
  }
  return s;
}
