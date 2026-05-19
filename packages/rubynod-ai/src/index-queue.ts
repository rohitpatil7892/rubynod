import type { CodebaseIndexer } from '@rubynod/index';
import type { IndexStats } from '@rubynod/index';

const buildLocks = new Map<string, Promise<IndexStats>>();

export function queueIndexBuild(
  workspaceRoot: string,
  indexer: CodebaseIndexer,
  onProgress?: Parameters<CodebaseIndexer['buildIndex']>[0]
): Promise<IndexStats> {
  const existing = buildLocks.get(workspaceRoot);
  if (existing) return existing;

  const job = indexer.buildIndex(onProgress).finally(() => {
    buildLocks.delete(workspaceRoot);
  });
  buildLocks.set(workspaceRoot, job);
  return job;
}

export function isIndexBuildQueued(workspaceRoot: string): boolean {
  return buildLocks.has(workspaceRoot);
}
