#!/usr/bin/env node
/** Build Rubynod on macOS, Windows, or Linux. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log(`Rubynod build — ${process.platform} ${process.arch}\n`);

const install = spawnSync(npm, ['install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (install.status !== 0) process.exit(install.status ?? 1);

const build = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(build.status ?? 0);
