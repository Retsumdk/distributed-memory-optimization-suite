#!/usr/bin/env bun
/**
 * distributed-memory-optimization-suite
 * Retention scoring, compaction, and budget enforcement for agent memory
 * in distributed systems.
 * Built by Retsumdk.
 */

export { MemoryCluster, type ClusterOptions } from "./cluster.js";
export { compactStore, type ClusterGroup } from "./compactor.js";
export { runDemo } from "./demo.js";
export { isMemoryError, MemoryError, type MemoryErrorCode } from "./errors.js";
export { evictToTarget } from "./evictor.js";
export { optimizeStore } from "./optimizer.js";
export { loadClusterState, saveClusterState } from "./persistence.js";
export { frequencyFactor, recencyFactor, scoreEntry } from "./scoring.js";
export { createMemoryServer, type ServerOptions } from "./server.js";
export { estimateTokens, isMemoryKind, MemoryStore, type StoreOptions } from "./store.js";
export { jaccard, textSimilarity, tokenize } from "./similarity.js";
export {
  DEFAULT_CONFIG,
  validateConfig,
  type ClusterReport,
  type ClusterStats,
  type CompactResult,
  type EvictResult,
  type MemoryEntry,
  type MemoryKind,
  type NewMemoryInput,
  type NodeReport,
  type NodeStats,
  type OptimizerConfig,
  type RetentionWeights,
} from "./types.js";
