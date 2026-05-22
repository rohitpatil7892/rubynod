/** VS Code @mention paths must not become literal filenames. */
export function normalizeToolFilePath(filePath: string): string {
  let p = filePath.trim().replace(/\\/g, '/');
  while (p.startsWith('@')) p = p.slice(1);
  return p;
}

/** Reject model output that is pseudo-JSON or wrong language, not real source. */
export function validateWriteContents(contents: string, relPath: string): string | null {
  const c = contents.trim();
  if (!c) return 'empty contents';

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
  return s.trim();
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

  return s;
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
