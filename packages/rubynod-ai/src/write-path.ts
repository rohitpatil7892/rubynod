import path from 'node:path';

const SENSIBLE_FILE =
  /^(?:src\/|lib\/|api\/|server\/|app\/)?[a-zA-Z][\w.-]*\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|json|md|yml|yaml|html|css|sh)$/;

/** Reject paths that look like the whole user prompt slugified into a filename. */
export function looksLikePromptSlug(filePath: string): boolean {
  const base = path.basename(filePath);
  const stem = path.basename(base, path.extname(base));
  const underscores = (stem.match(/_/g) || []).length;
  const parts = stem.split('_').filter(Boolean);

  if (stem.length >= 48 && underscores >= 4) return true;
  if (parts.length >= 8) return true;
  if (stem.length < 32 && underscores < 3) return false;
  if (SENSIBLE_FILE.test(filePath.replace(/\\/g, '/'))) return false;

  return underscores >= 4 || base.length > 72;
}

function inferPathFromContents(contents: string, userPath: string): string {
  const c = contents.trim();
  if (
    /require\s*\(\s*['"]express['"]\)|from\s+['"]express['"]|import\s+express|const\s+app\s*=\s*express\s*\(/i.test(
      c
    )
  ) {
    return 'server.js';
  }
  if (/from\s+fastapi|import\s+fastapi/i.test(c)) return 'main.py';
  if (/from\s+flask|import\s+Flask/i.test(c)) return 'app.py';
  if (/package\s+main|func\s+main\s*\(/i.test(c)) return 'main.go';
  if (/fn\s+main\s*\(|use\s+actix/i.test(c)) return 'src/main.rs';
  if (/^\s*import\s+/.test(c) || /^\s*from\s+\w+\s+import/m.test(c)) {
    if (/def\s+\w+\s*\(/.test(c)) return 'app.py';
  }
  if (
    /^\s*(const|let|var)\s+/m.test(c) ||
    /require\s*\(|module\.exports|export\s+(default\s+)?(?:async\s+)?function/.test(c)
  ) {
    return 'server.js';
  }
  const ext = path.extname(userPath);
  if (ext && ext.length <= 5) {
    const stem = path.basename(userPath, ext).slice(0, 24).replace(/[^a-zA-Z0-9_-]+/g, '-');
    return `${stem || 'app'}${ext}`;
  }
  return 'server.js';
}

/**
 * Map model-provided paths to short conventional names when the model slugifies the user message.
 */
export function resolveWritePath(
  requestedPath: string,
  contents: string
): { path: string; corrected: boolean } {
  let p = requestedPath.trim().replace(/\\/g, '/');
  while (p.startsWith('@')) p = p.slice(1);
  if (!p) return { path: 'server.js', corrected: true };
  if (p.startsWith('/')) p = p.replace(/^\/+/, '');

  if (!looksLikePromptSlug(p)) {
    return { path: p, corrected: false };
  }

  return { path: inferPathFromContents(contents, p), corrected: true };
}
