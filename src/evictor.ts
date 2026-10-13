import { MemoryError } from "./errors.js";
import { scoreEntry } from "./scoring.js";
import type { MemoryStore } from "./store.js";
import type { EvictResult, OptimizerConfig } from "./types.js";

export function evictToTarget(
  store: MemoryStore,
  config: OptimizerConfig,
  now: number,
  targetTokens?: number,
): EvictResult {
  const target =
    targetTokens ?? Math.floor(store.capacityTokens * config.targetUtilization);
  if (!Number.isInteger(target) || target < 0) {
    throw new MemoryError("CONFIG", `targetTokens must be an integer >= 0, got ${target}`);
  }

  const candidates = store
    .entries()
    .filter((entry) => !entry.pinned)
    .sort((a, b) => {
      const delta = scoreEntry(a, now, config) - scoreEntry(b, now, config);
      if (delta !== 0) return delta;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const evictedIds: string[] = [];
  let freed = 0;
  for (const victim of candidates) {
    if (store.usedTokens() <= target) break;
    const tokens = victim.tokens;
    store.remove(victim.id);
    evictedIds.push(victim.id);
    freed += tokens;
  }

  return { node: store.id, evictedIds, tokensFreed: freed, targetTokens: target };
}
