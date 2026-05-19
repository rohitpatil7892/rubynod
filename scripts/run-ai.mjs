#!/usr/bin/env node
/** Cross-platform Rubynod AI service launcher (macOS, Windows, Linux). */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'packages', 'rubynod-ai', 'dist', 'server.js');

const child = spawn(process.execPath, [entry], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, RUBYNOD_AI_PORT: process.env.RUBYNOD_AI_PORT ?? '3847' },
});

child.on('exit', (code) => process.exit(code ?? 0));
