#!/usr/bin/env node
/**
 * Phase 1: copy built @rubynod/* packages + install runtime deps into
 * extensions/rubynod-ai-ui/server/ for bundling inside the VSIX.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extRoot = path.join(root, 'extensions', 'rubynod-ai-ui');
const serverRoot = path.join(extRoot, 'server');
const vendorRoot = path.join(serverRoot, 'vendor');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const packages = [
  { name: '@rubynod/ai', src: 'packages/rubynod-ai', copyDist: true },
  { name: '@rubynod/index', src: 'packages/rubynod-index', copyDist: true },
  { name: '@rubynod/mcp', src: 'packages/rubynod-mcp', copyDist: true },
];

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    if (e && (e.code === 'ENOTEMPTY' || e.code === 'EBUSY' || e.code === 'EPERM')) {
      const tmp = `${dir}.delete-${Date.now()}`;
      fs.renameSync(dir, tmp);
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      return;
    }
    throw e;
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function ensureBuilt() {
  for (const pkg of packages) {
    const dist = path.join(root, pkg.src, 'dist', 'server.js');
    const main = path.join(root, pkg.src, 'dist', 'index.js');
    const check = pkg.name === '@rubynod/ai' ? dist : main;
    if (!fs.existsSync(check)) {
      console.error(`Missing build output: ${check}\nRun: npm run build`);
      process.exit(1);
    }
  }
}

function writeVendorPackage(name, srcDir) {
  const srcPkgPath = path.join(root, srcDir, 'package.json');
  const pkg = readJson(srcPkgPath);
  const destDir = path.join(vendorRoot, name.replace('@rubynod/', 'rubynod-'));
  rmrf(destDir);
  fs.mkdirSync(destDir, { recursive: true });
  copyDir(path.join(root, srcDir, 'dist'), path.join(destDir, 'dist'));
  const out = {
    name: pkg.name,
    version: pkg.version,
    type: pkg.type ?? 'module',
    main: pkg.main ?? './dist/index.js',
    dependencies: pkg.dependencies ?? {},
  };
  fs.writeFileSync(path.join(destDir, 'package.json'), JSON.stringify(out, null, 2));
  return destDir;
}

const PRUNE_DIR_NAMES = new Set([
  'test',
  'tests',
  '__tests__',
  'docs',
  'doc',
  'example',
  'examples',
  '.github',
]);

/** Replace npm `file:` symlinks so vsce can pack the VSIX (yazl rejects symlinks). */
function materializeFileDeps(serverRoot) {
  const scopeDir = path.join(serverRoot, 'node_modules', '@rubynod');
  if (!fs.existsSync(scopeDir)) return;
  for (const name of fs.readdirSync(scopeDir)) {
    const pkgDir = path.join(scopeDir, name);
    let stat;
    try {
      stat = fs.lstatSync(pkgDir);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) continue;
    const real = fs.realpathSync(pkgDir);
    console.log(`Materialize @rubynod/${name} ← ${real}`);
    rmrf(pkgDir);
    copyDir(real, pkgDir);
  }
}

function pruneServerBundle(serverRoot) {
  const nm = path.join(serverRoot, 'node_modules');
  if (!fs.existsSync(nm)) return;
  let removed = 0;

  const dropPath = (p) => {
    try {
      rmrf(p);
      removed++;
    } catch {
      // ignore
    }
  };

  // Only strip OpenAI TypeScript sources — _vendor/*.mjs is required at runtime.
  dropPath(path.join(nm, 'openai', 'src'));

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (PRUNE_DIR_NAMES.has(ent.name)) {
          dropPath(p);
          continue;
        }
        walk(p);
      } else if (/\.(md|markdown|map)$/i.test(ent.name)) {
        try {
          fs.unlinkSync(p);
          removed++;
        } catch {
          // ignore
        }
      }
    }
  };
  walk(nm);
  console.log(`Pruned ${removed} paths from server/node_modules`);
}

function main() {
  console.log('Bundling Rubynod AI service into extension…\n');
  ensureBuilt();

  fs.mkdirSync(serverRoot, { recursive: true });
  for (const sub of ['node_modules', 'dist', 'vendor', 'package-lock.json']) {
    rmrf(path.join(serverRoot, sub));
  }
  fs.mkdirSync(vendorRoot, { recursive: true });

  writeVendorPackage('@rubynod/index', 'packages/rubynod-index');
  writeVendorPackage('@rubynod/mcp', 'packages/rubynod-mcp');

  const aiPkg = readJson(path.join(root, 'packages', 'rubynod-ai', 'package.json'));
  const indexVendor = path.join(vendorRoot, 'rubynod-index');
  const mcpVendor = path.join(vendorRoot, 'rubynod-mcp');
  const serverPkg = {
    name: 'rubynod-bundled-ai',
    private: true,
    type: 'module',
    version: '0.1.0',
    description: 'Bundled Rubynod AI service (shipped inside rubynod-ai-ui VSIX)',
    main: './dist/server.js',
    dependencies: {
      '@rubynod/index': `file:${path.relative(serverRoot, indexVendor).replace(/\\/g, '/')}`,
      '@rubynod/mcp': `file:${path.relative(serverRoot, mcpVendor).replace(/\\/g, '/')}`,
      ...Object.fromEntries(
        Object.entries(aiPkg.dependencies ?? {}).filter(([k]) => !k.startsWith('@rubynod/'))
      ),
    },
  };

  fs.writeFileSync(path.join(serverRoot, 'package.json'), JSON.stringify(serverPkg, null, 2));
  copyDir(path.join(root, 'packages', 'rubynod-ai', 'dist'), path.join(serverRoot, 'dist'));

  console.log('Installing server runtime dependencies…');
  const install = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: serverRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }

  materializeFileDeps(serverRoot);

  const entry = path.join(serverRoot, 'dist', 'server.js');
  if (!fs.existsSync(entry)) {
    console.error(`Bundle failed: missing ${entry}`);
    process.exit(1);
  }

  const wasmSrc = path.join(serverRoot, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (fs.existsSync(wasmSrc)) {
    fs.copyFileSync(wasmSrc, path.join(serverRoot, 'dist', 'sql-wasm.wasm'));
    console.log('Copied sql-wasm.wasm into server/dist');
  }

  pruneServerBundle(serverRoot);

  console.log(`\nBundled AI service → ${path.relative(root, serverRoot)}`);
  console.log(`Entry: dist/server.js (in-process or child process)`);
}

main();
