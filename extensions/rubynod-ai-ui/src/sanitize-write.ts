/** Same rules as @rubynod/ai sanitize-code — applied in the IDE before disk write. */
export function sanitizeWriteContent(content: string): string {
  let s = content.replace(/^\uFEFF/, '').trim();

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

  return lines.join('\n').trim();
}
