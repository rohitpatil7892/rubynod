import os from 'node:os';
import path from 'node:path';

export type RubynodPlatform = 'macos' | 'windows' | 'linux' | 'unknown';

export function getPlatform(): RubynodPlatform {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

export function isMac(): boolean {
  return process.platform === 'darwin';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

/** User config dir: ~/.rubynod on Unix, %USERPROFILE%\\.rubynod on Windows */
export function getRubynodHome(): string {
  return path.join(os.homedir(), '.rubynod');
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Default shell for integrated terminal / agent commands */
export function getDefaultShell(): string {
  if (isWindows()) {
    return process.env.COMSPEC ?? 'cmd.exe';
  }
  return process.env.SHELL ?? '/bin/bash';
}

/** ripgrep executable (must be on PATH for agent grep) */
export function getRgCommand(): string {
  return isWindows() ? 'rg.exe' : 'rg';
}

export const SUPPORTED_PLATFORMS = ['macOS', 'Windows', 'Linux'] as const;

export const PLATFORM_REQUIREMENTS = {
  node: '>=20',
  ram: '4 GB minimum, 8 GB recommended',
  disk: '2 GB for editor build + index',
} as const;
