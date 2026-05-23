/** VS Code @mention paths must not become literal filenames. */
export function normalizeToolFilePath(filePath: string): string {
  let p = filePath.trim().replace(/\\/g, '/');
  while (p.startsWith('@')) p = p.slice(1);
  return p;
}

/** Stub comments models write instead of real implementations. */
export function looksLikePlaceholderStub(contents: string): boolean {
  const c = contents.trim();
  if (!c) return true;
  if (
    /placeholder|implement your logic here|you can implement|TODO:\s*implement/i.test(c)
  ) {
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

/** Trailing `}}`, `"`, or backticks from broken tool JSON pasted into file bodies. */
export function stripBrokenJsonTail(contents: string): string {
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

/** Leaked tool-call JSON (structure is predictable — not open-ended prose). */
export function looksLikeToolCallJsonLeak(contents: string): boolean {
  const c = contents.trim();
  if (/\[tool[_\s-]?calls?\]/i.test(c)) return true;
  if (/^\{\s*$/.test(c)) return true;
  if (/^\{\s*"name"\s*:\s*"(?:write_file|read_file|search_replace|glob|grep)"/m.test(c)) {
    return true;
  }
  if (/"name"\s*:\s*"(?:write_file|read_file|search_replace)"[\s\S]*"arguments"\s*:\s*\{/.test(c)) {
    return true;
  }
  if (/```json\s*\n\s*\{[\s\S]*"name"\s*:\s*"/m.test(c)) return true;
  if (/\n\}\s*\n```\s*\n[\s\S]*#{1,3}\s+/m.test(c)) return true;
  return false;
}

function countRegexMatches(re: RegExp, text: string): number {
  return (text.match(re) ?? []).length;
}

function hasSubstantiveSourceTokens(text: string): boolean {
  return /\b(?:import|export|require|class\s+\w|function\s+\w|interface\s+\w|type\s+\w|const\s+\w+\s*=|module\.exports|def\s+\w+\s*\(|package\s+\w+)\b/.test(
    text
  );
}

/**
 * Heuristic score for instructional chat prose (not a phrase allowlist).
 * High score = numbered steps, headings, "you can/let's", guide opener, little real code.
 */
export function tutorialProseScore(contents: string): number {
  const c = contents.trim();
  if (!c) return 0;

  let score = 0;

  const numberedSteps = countRegexMatches(/(?:^|\n)\s*\d+\.\s+\S/gim, c);
  if (numberedSteps >= 2) score += 3;
  else if (numberedSteps === 1) score += 1;

  const markdownHeadings = countRegexMatches(/(?:^|\n)#{1,3}\s+\S/gim, c);
  if (markdownHeadings >= 1) score += 2;
  if (/(?:^|\n)#{1,3}\s*step\s*\d*/im.test(c)) score += 2;

  const instructional = countRegexMatches(
    /\b(?:you can|let's|we'll|we will|follow these steps|here(?:'s| is) how|make sure to|(?:^|\n)\s*(?:first|next|then|finally)[,:]?\s)/gim,
    c
  );
  if (instructional >= 2) score += 2;
  else if (instructional === 1) score += 1;

  if (/^(?:to\s+)?(?:add|create|implement|set up|build|generate)\s+(?:a\s+)?(?:new\s+)?/im.test(c)) {
    score += 2;
  }

  const lines = c.split('\n').filter((l) => l.trim());
  const codeLikeLines = lines.filter((l) =>
    /^\s*(?:import|export|const|let|var|function|class|interface|type|#include|def |package |public |private |@Injectable|@Component)\b/.test(
      l
    )
  ).length;

  if (lines.length >= 4 && codeLikeLines === 0 && c.length > 100) score += 3;
  if (lines.length >= 3 && codeLikeLines <= 1 && numberedSteps >= 1) score += 2;
  if (/\blet's start\b/i.test(c) && !hasSubstantiveSourceTokens(c)) score += 2;

  return score;
}

/** Tutorial / step-by-step chat the model pasted instead of source or tool calls. */
export function looksLikeTutorialProse(contents: string, threshold = 4): boolean {
  return tutorialProseScore(contents) >= threshold;
}

/** Tool JSON leak or tutorial prose (dynamic heuristics + structural JSON checks). */
export function looksLikeTutorialOrToolLeak(contents: string): boolean {
  return looksLikeToolCallJsonLeak(contents) || looksLikeTutorialProse(contents);
}

/** Reject model output that is pseudo-JSON or wrong language, not real source. */
export function validateWriteContents(contents: string, relPath: string): string | null {
  const c = contents.trim();
  if (!c) return 'empty contents';

  if (looksLikeTutorialOrToolLeak(c)) {
    return 'contents are chat/tutorial text or leaked tool JSON — use write_file with only real source code';
  }

  if (looksLikePlaceholderStub(c)) {
    return 'contents are placeholder comments only — write a complete implementation (imports, exports, real logic)';
  }

  if (
    /\}\s*\}\s*[`'"]*\s*$/m.test(c) &&
    !/\bexport\s+(?:default\s+)?(?:class|function|const|interface|type)\b/.test(c) &&
    !/\bmodule\.exports\b/.test(c)
  ) {
    return 'contents end with broken JSON/tool braces (}}) — send only valid source code in contents';
  }

  if (/\.service\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) {
    const substantive = c.split('\n').filter((line) => {
      const t = line.trim();
      return t && !/^\/\//.test(t) && !/^\/\*/.test(t) && !/^\*/.test(t);
    });
    if (substantive.length < 5) {
      return 'service file is too short — include real TypeScript/JavaScript (imports, class or functions, exports), not comments only';
    }
  }

  if (/^\{\s*"(?:import|export|const|let|var|require|def\s)/m.test(c)) {
    return 'contents look like broken JSON-wrapped code (starts with {"import / {"export) — send raw source only';
  }
  if (/^\{\s*"name"\s*:\s*"(?:write_file|search_replace)"/.test(c)) {
    return 'contents are a tool-call JSON blob, not file source';
  }

  const ext = relPath.replace(/^@+/, '').split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext) && /^\s*def\s+\w+\s*\(/m.test(c)) {
    return 'Python syntax in a JavaScript/TypeScript file';
  }
  if (
    ['ts', 'tsx', 'js', 'jsx'].includes(ext) &&
    /import\s*\{[^}]*\}\s*from\s+"[^"]*"/.test(c) &&
    !/from\s+['"]/.test(c)
  ) {
    return 'invalid import quotes (use single quotes for module names in JS/TS)';
  }

  return null;
}

/** Ollama often sends `\\n` in write_file contents instead of real newlines. */
export function unescapeLiteralEscapes(contents: string): string {
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

/** Strip trailing tool-JSON junk models append to file bodies. */
export function stripTrailingToolJsonGarbage(contents: string): string {
  let s = contents.trim();
  s = s.replace(/",\s*"file"\s*:\s*"[^"]*"\s*\}\}\s*$/g, '');
  s = s.replace(/"\}\}\s*$/g, '');
  s = s.replace(/\}\}\s*$/g, '');
  return stripBrokenJsonTail(s);
}

/** Reject tiny overwrites of large existing files (incremental "Added GET..." spam). */
export function validateDestructiveOverwrite(
  contents: string,
  relPath: string,
  existingContent: string
): string | null {
  if (!existingContent.trim()) return null;
  const oldLines = existingContent.split('\n').length;
  const newLines = contents.split('\n').length;
  const oldLen = existingContent.length;
  const newLen = contents.length;

  if (oldLines >= 8 && newLines <= 6 && newLen < oldLen * 0.35) {
    return `partial write (${newLines} lines) would destroy existing ${relPath} (${oldLines} lines) — use search_replace`;
  }
  if (oldLen > 400 && newLen < oldLen * 0.2) {
    return `write is too small (${newLen} chars vs existing ${oldLen}) — use read_file + search_replace`;
  }
  if (/^Added\s+/i.test(contents.trim()) && newLines <= 3) {
    return 'contents look like chat text ("Added GET..."), not source code';
  }
  return null;
}

/** Strip markdown/HTML wrappers models sometimes put in write_file contents. */
export function sanitizeFileContents(contents: string): string {
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

  // Fix common model typo: `database: 'x';` → `database: 'x',` inside object literals
  s = s.replace(
    /(database\s*:\s*['"][^'"]+['"])\s*;(\s*[\r\n]+\s*\})/g,
    '$1,$2'
  );

  // Leading `{"import` / `{"export` artifact from failed JSON tool calls
  if (/^\{\s*"(?:import|export|const|let|var|require)\s/.test(s)) {
    s = s.replace(/^\{\s*/, '');
  }

  // Truncate after code fence + tutorial (model leaked Steps 2–3 into the file)
  const tutorialCut = s.search(
    /\n(?:```\s*\n)?#{2,3}\s+Step\s+\d|\n\}\s*\n```\s*\n[\s\S]{0,200}#{2,3}\s+Step|\n```\s*\n\s*\{[\s\S]{0,400}"name"\s*:\s*"read_file"/m
  );
  if (tutorialCut > 40) s = s.slice(0, tutorialCut).trim();

  // Trailing broken export + JSON garbage
  s = s.replace(/\s*"\s*\n\s*\}\s*\n\}\s*```[\s\S]*$/m, '');
  s = s.replace(/\s*;\s*"\s*\n\s*\}\s*\}\s*```[\s\S]*$/m, ';');

  return s.trim();
}

/** Models paste full package.json in chat instead of editing the @mentioned file. */
export function stripLeakedPackageJson(text: string): string {
  let s = text;
  s = s.replace(/```json\s*\n(\{[\s\S]*?"dependencies"\s*:\s*\{[\s\S]*?\}[\s\S]*?\})\s*```/gi, '');
  s = s.replace(
    /^\s*\{\s*\n?\s*"name"\s*:\s*"[^"]+",[\s\S]*?"dependencies"\s*:\s*\{[\s\S]*?\}\s*\}\s*$/gm,
    ''
  );
  return s;
}

/** Incomplete Ollama tool JSON leaked into chat (`json` + `{"name`). */
export function stripPartialToolJsonLeak(text: string): string {
  let s = text;
  s = s.replace(/```json\s*\n?[\s\S]*$/gi, '');
  s = s.replace(/^json\s*\n?/gi, '');
  s = s.replace(/^\s*\{\s*"name"[\s\S]*$/gi, '');
  s = s.replace(/^\s*\{\s*"name\s*$/gi, '');
  return s.trim();
}

/** True when the model returned tool-call garbage but did not run tools. */
export function isFailedToolOnlyResponse(text: string): boolean {
  const t = stripPartialToolJsonLeak(stripAssistantChatNoise(text)).trim();
  if (!t) return true;
  if (/^json\s*$/i.test(t)) return true;
  if (/^\{\s*"name/i.test(t)) return true;
  if (/```json/i.test(t) && /\{\s*"name/i.test(t)) return true;
  return false;
}

/** Remove tool-result echoes and context blocks models paste into chat. */
export function stripAssistantChatNoise(text: string): string {
  let s = stripLeakedPackageJson(text);
  s = s.replace(/## Context: file — @?[^\n]+\n[\s\S]*?(?=\n## Context:|\n## |$)/g, '');
  s = s.replace(/### File: @?[^\n]+\n\n(?:ts|js|json|py)\n[\s\S]*?(?=\n## |\n### |\n\n[A-Z]|$)/gi, '');
  s = s.replace(
    /^(?:Created|Updated) (?:new |existing )?file [^\n]+ \(\d+ lines[^\n]*\)[^\n]*\n?/gim,
    ''
  );
  s = s.replace(/^Added to package\.json dependencies:[^\n]*\n?/gim, '');
  s = s.replace(/^Added[^\n]*\n?/gim, '');
  s = s.replace(/\(file already existed[^\n]*\)\n?/gim, '');
  s = s.replace(/^Patched @?[^\n]+\n?/gim, '');
  s = s.replace(/\/\/ Example: read from MySQL[^\n]*\n?/gim, '');
  s = s.replace(/```json\s*```/gi, '');
  s = s.replace(/^json\s*$/gim, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
