import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs, { type SqlJsStatic } from 'sql.js';

const require = createRequire(import.meta.url);

let sqlEngine: SqlJsStatic | null = null;
let initPromise: Promise<SqlJsStatic> | null = null;

function resolveWasmDir(): string {
  const dirs: string[] = [];
  try {
    dirs.push(path.join(path.dirname(require.resolve('sql.js/package.json')), 'dist'));
  } catch {
    // ignore
  }
  try {
    dirs.push(path.dirname(require.resolve('./sql-init.js')));
  } catch {
    // ignore
  }
  dirs.push(path.join(process.cwd(), 'dist'), path.join(process.cwd(), 'node_modules', 'sql.js', 'dist'));
  for (const dir of dirs) {
    if (fs.existsSync(path.join(dir, 'sql-wasm.wasm'))) return dir;
  }
  throw new Error('sql-wasm.wasm not found. Run npm install and npm run bundle:server.');
}

/** Load sql.js WASM once (safe in VS Code extension host and bundled server). */
export async function initSqlEngine(): Promise<SqlJsStatic> {
  if (sqlEngine) return sqlEngine;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const distDir = resolveWasmDir();
    const wasmFile = path.join(distDir, 'sql-wasm.wasm');
    if (!fs.existsSync(wasmFile)) {
      throw new Error(`sql.js wasm not found at ${wasmFile}. Run npm install in the rubynod repo.`);
    }
    sqlEngine = await initSqlJs({
      locateFile: (file) => path.join(distDir, file),
    });
    return sqlEngine;
  })();

  return initPromise;
}

export function getSqlEngine(): SqlJsStatic {
  if (!sqlEngine) {
    throw new Error('SQL engine not initialized. Call initSqlEngine() first.');
  }
  return sqlEngine;
}

export function isSqlEngineReady(): boolean {
  return sqlEngine !== null;
}
