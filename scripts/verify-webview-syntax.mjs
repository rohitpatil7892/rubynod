#!/usr/bin/env node
/**
 * Ensures chat-ui webview embedded JS parses (catches \\n vs \n bugs in template literals).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { getChatHtml } = require(join(root, 'extensions/rubynod-ai-ui/dist/chat-ui.js'));

const html = getChatHtml('agent', '0.0.0', {
  serviceUrl: 'http://127.0.0.1:3847',
  ollamaHost: 'http://127.0.0.1:11434',
  providers: [{ id: 'ollama', label: 'Ollama' }],
});

const scripts = [...html.matchAll(/<script nonce=[^>]+>([\s\S]*?)<\/script>/g)];
if (scripts.length < 2) {
  console.error('verify-webview-syntax: expected 2 script blocks, got', scripts.length);
  process.exit(1);
}

const tmp = join(root, '.tmp-webview-check.js');
writeFileSync(tmp, scripts[1][1]);
const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}
console.log('Webview script syntax OK');
