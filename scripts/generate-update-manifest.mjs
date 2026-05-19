#!/usr/bin/env node
/**
 * Generate VS Code–compatible update JSON for GitHub raw hosting.
 *
 * The desktop app requests:
 *   {updateUrl}/api/update/{platform}/{quality}/{commit}
 *
 * Usage:
 *   node scripts/generate-update-manifest.mjs \
 *     --version 0.2.0 \
 *     --commit rubynod-dev \
 *     --repo owner/rubynod \
 *     --darwin-arm64-url https://github.com/.../Rubynod-darwin-arm64.zip \
 *     --darwin-x64-url ... --win32-x64-url ... --linux-x64-url ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const version = (arg('version') || '0.1.0').replace(/^v/, '');
const commit = arg('commit', 'rubynod-dev');
const quality = arg('quality', 'stable');
const repo = arg('repo', process.env.GITHUB_REPOSITORY || 'rohitpatil7892/rubynod');
const timestamp = Date.now();

function manifest(platformKey, downloadUrl, sha256 = '') {
  const productVersion = version;
  return {
    version: commit,
    name: version,
    productVersion,
    platform: platformKey,
    url: downloadUrl,
    timestamp,
    sha256hash: sha256,
  };
}

const releaseBase = `https://github.com/${repo}/releases/download/v${version}`;
const defaults = {
  'darwin-arm64': `${releaseBase}/Rubynod-darwin-arm64.zip`,
  'darwin-x64': `${releaseBase}/Rubynod-darwin-x64.zip`,
  'win32-x64': `${releaseBase}/Rubynod-win32-x64.zip`,
  'linux-x64': `${releaseBase}/Rubynod-linux-x64.zip`,
};

const platforms = [
  { file: 'darwin/stable/rubynod-dev.json', platform: 'darwin', url: arg('darwin-arm64-url', defaults['darwin-arm64']) },
  { file: 'darwin-x64/stable/rubynod-dev.json', platform: 'darwin', url: arg('darwin-x64-url', defaults['darwin-x64']) },
  { file: 'win32/stable/rubynod-dev.json', platform: 'win32', url: arg('win32-x64-url', defaults['win32-x64']) },
  { file: 'linux/stable/rubynod-dev.json', platform: 'linux', url: arg('linux-x64-url', defaults['linux-x64']) },
];

const outRoot = path.join(root, 'updates', 'api', 'update');
for (const p of platforms) {
  const dir = path.join(outRoot, p.file.replace(/\/[^/]+$/, ''));
  fs.mkdirSync(dir, { recursive: true });
  const body = manifest(p.platform, p.url, arg(`sha256-${p.platform}`, ''));
  const outPath = path.join(outRoot, p.file);
  fs.writeFileSync(outPath, JSON.stringify(body, null, 2) + '\n');
  console.log('Wrote', path.relative(root, outPath));
}

const latestMeta = {
  version,
  commit,
  quality,
  repo,
  generatedAt: new Date().toISOString(),
  extensionVsix: `${releaseBase}/rubynod-ai-ui-${version}.vsix`,
};
fs.writeFileSync(path.join(root, 'updates', 'latest.json'), JSON.stringify(latestMeta, null, 2) + '\n');
console.log('Wrote updates/latest.json');
