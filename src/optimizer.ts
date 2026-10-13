import { compactStore } from "./compactor.js";
import { evictToTarget } from "./evictor.js";
import type { MemoryStore } from "./store.js";
import type { NodeReport, OptimizerConfig } from "./types.js";

export function optimizeStore(
  store: MemoryStore,
  config: OptimizerConfig,
  now: number,
): NodeReport {
  const entriesBefore = store.stats().entries;
  const tokensBefore = store.usedTokens();

  const compact = compactStore(store, config, now);
  const evict = evictToTarget(store, config, now);

  return {
    node: store.id,
    entriesBefore,
    entriesAfter: store.stats().entries,
    tokensBefore,
    tokensAfter: store.usedTokens(),
    tokensFreed: tokensBefore - store.usedTokens(),
    clustersMerged: compact.clustersMerged,
    summariesCreated: compact.summariesCreated,
    evictedIds: evict.evictedIds,
  };
}
