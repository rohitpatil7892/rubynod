#!/usr/bin/env node
/**
 * Sync root package.json version → product.json + extension package.json
 * Usage: node scripts/sync-version.mjs [version]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.argv[2] ?? rootPkg.version;

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Invalid version:', version);
  process.exit(1);
}

rootPkg.version = version.replace(/^v/, '');
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(rootPkg, null, 2) + '\n');

const productPath = path.join(root, 'product.json');
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
product.version = rootPkg.version;
product.date = new Date().toISOString().slice(0, 10);
fs.writeFileSync(productPath, JSON.stringify(product, null, 2) + '\n');

const extPath = path.join(root, 'extensions/rubynod-ai-ui/package.json');
const ext = JSON.parse(fs.readFileSync(extPath, 'utf8'));
ext.version = rootPkg.version;
fs.writeFileSync(extPath, JSON.stringify(ext, null, 2) + '\n');

console.log(`Synced version ${rootPkg.version} → product.json, rubynod-ai-ui`);
