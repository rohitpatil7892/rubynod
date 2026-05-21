/** Strip markdown/HTML wrappers models sometimes put in write_file contents. */
export function sanitizeFileContents(contents: string): string {
  let s = contents.replace(/^\uFEFF/, '').trim();

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

  return s;
}
