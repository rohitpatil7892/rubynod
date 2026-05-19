#!/usr/bin/env node
/**
 * Resize an image to the VS Code Marketplace extension icon (128×128 PNG).
 *
 * Usage:
 *   node scripts/set-extension-icon.mjs path/to/your-logo.png
 *
 * Output: extensions/rubynod-ai-ui/media/icon-128.png
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'extensions/rubynod-ai-ui/media/icon-128.png');
const src = process.argv[2];

if (!src) {
  console.error('Usage: node scripts/set-extension-icon.mjs <image-file>');
  process.exit(1);
}

const abs = path.resolve(src);
if (!fs.existsSync(abs)) {
  console.error('File not found:', abs);
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(abs, out);

try {
  execSync(`sips -z 128 128 "${out}"`, { stdio: 'inherit' });
} catch {
  console.warn('sips not available; ensure the image is 128×128 PNG for Marketplace.');
}

console.log('Wrote', out);
console.log('Rebuild VSIX: npm run package:ext');
