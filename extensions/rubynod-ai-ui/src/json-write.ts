import * as path from 'node:path';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isJsonFilePath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base.endsWith('.json') || base === '.eslintrc';
}

function isPackageJson(filePath: string): boolean {
  return path.basename(filePath) === 'package.json';
}

function mergePackageJson(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...oldObj, ...newObj };
  for (const key of [
    'scripts',
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const o = oldObj[key];
    const n = newObj[key];
    if (isPlainObject(o)) {
      out[key] = isPlainObject(n) ? { ...o, ...n } : o;
    }
  }
  return out;
}

export function prepareJsonWrite(
  filePath: string,
  newContent: string,
  oldContent?: string
): string {
  if (!isJsonFilePath(filePath)) return newContent;

  const trimmed = newContent.trim();
  if (!trimmed) return newContent;

  try {
    const newVal: unknown = JSON.parse(trimmed);
    let merged: unknown = newVal;

    if (oldContent?.trim()) {
      try {
        const oldVal: unknown = JSON.parse(oldContent.trim());
        if (isPackageJson(filePath) && isPlainObject(oldVal) && isPlainObject(newVal)) {
          merged = mergePackageJson(oldVal, newVal);
        }
      } catch {
        /* keep new only */
      }
    }

    return `${JSON.stringify(merged, null, 2)}\n`;
  } catch {
    return newContent;
  }
}
