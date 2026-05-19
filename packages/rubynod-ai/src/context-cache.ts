import type { ContextPack } from '@rubynod/index';

interface CacheEntry {
  pack: ContextPack;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedContextPack(
  workspaceRoot: string,
  query: string,
  ttlSec: number
): ContextPack | null {
  if (ttlSec <= 0) return null;
  const key = `${workspaceRoot}\0${query.trim().toLowerCase().slice(0, 256)}`;
  const hit = cache.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    if (hit) cache.delete(key);
    return null;
  }
  return hit.pack;
}

export function setCachedContextPack(
  workspaceRoot: string,
  query: string,
  pack: ContextPack,
  ttlSec: number
): void {
  if (ttlSec <= 0) return;
  const key = `${workspaceRoot}\0${query.trim().toLowerCase().slice(0, 256)}`;
  cache.set(key, { pack, expiresAt: Date.now() + ttlSec * 1000 });
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}
