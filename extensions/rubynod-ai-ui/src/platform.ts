import * as os from 'node:os';
import * as path from 'node:path';

export type PlatformId = 'macos' | 'windows' | 'linux';

export function getPlatformId(): PlatformId {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function getModKeyLabel(): string {
  return process.platform === 'darwin' ? '⌘' : 'Ctrl';
}

export function formatShortcut(keys: string): string {
  if (process.platform === 'darwin') {
    return keys.replace(/ctrl/gi, '⌘').replace(/cmd/gi, '⌘');
  }
  return keys.replace(/cmd/gi, 'Ctrl').replace(/⌘/g, 'Ctrl');
}

export function buildRipgrepShell(pattern: string, target: string): string {
  const escapedPattern = pattern.replace(/"/g, '\\"');
  const escapedTarget = target.replace(/"/g, '\\"');
  if (isWindows()) {
    return `rg --no-heading -n -m 50 "${escapedPattern}" "${escapedTarget}" 2>nul`;
  }
  return `rg --no-heading -n -m 50 ${JSON.stringify(pattern)} ${JSON.stringify(target)} 2>/dev/null || true`;
}

export function getRubynodDataDir(): string {
  return path.join(os.homedir(), '.rubynod');
}
