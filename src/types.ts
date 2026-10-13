import { MemoryError } from "./errors.js";

export type MemoryKind = "episodic" | "fact" | "summary";

export interface MemoryEntry {
  readonly id: string;
  readonly node: string;
  agent: string;
  content: string;
  tokens: number;
  kind: MemoryKind;
  importance: number;
  createdAt: number;
  lastAccessAt: number;
  accessCount: number;
  pinned: boolean;
  sources: string[];
  tags: string[];
}

export interface NewMemoryInput {
  node: string;
  agent?: string;
  content: string;
  tokens?: number;
  kind?: MemoryKind;
  importance?: number;
  pinned?: boolean;
  tags?: string[];
  id?: string;
  createdAt?: number;
  lastAccessAt?: number;
  accessCount?: number;
  sources?: string[];
}

export interface RetentionWeights {
  recency: number;
  frequency: number;
  importance: number;
}

export interface OptimizerConfig {
  halfLifeMs: number;
  weights: RetentionWeights;
  similarityThreshold: number;
  minClusterSize: number;
  targetUtilization: number;
  summaryHeadChars: number;
  compressionRatio: number;
}

export const DEFAULT_CONFIG: OptimizerConfig = {
  halfLifeMs: 86_400_000,
  weights: { recency: 1, frequency: 0.5, importance: 1.5 },
  similarityThreshold: 0.45,
  minClusterSize: 2,
  targetUtilization: 0.6,
  summaryHeadChars: 400,
  compressionRatio: 0.35,
};

export function validateConfig(config: OptimizerConfig): void {
  if (!Number.isFinite(config.halfLifeMs) || config.halfLifeMs <= 0) {
    throw new MemoryError("CONFIG", `halfLifeMs must be > 0, got ${config.halfLifeMs}`);
  }
  for (const [name, value] of Object.entries(config.weights)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new MemoryError("CONFIG", `weight.${name} must be a non-negative number, got ${value}`);
    }
  }
  if (!Number.isFinite(config.similarityThreshold) || config.similarityThreshold <= 0 || config.similarityThreshold > 1) {
    throw new MemoryError("CONFIG", `similarityThreshold must be in (0, 1], got ${config.similarityThreshold}`);
  }
  if (!Number.isInteger(config.minClusterSize) || config.minClusterSize < 2) {
    throw new MemoryError("CONFIG", `minClusterSize must be an integer >= 2, got ${config.minClusterSize}`);
  }
  if (!Number.isFinite(config.targetUtilization) || config.targetUtilization <= 0 || config.targetUtilization > 1) {
    throw new MemoryError("CONFIG", `targetUtilization must be in (0, 1], got ${config.targetUtilization}`);
  }
  if (!Number.isInteger(config.summaryHeadChars) || config.summaryHeadChars < 20) {
    throw new MemoryError("CONFIG", `summaryHeadChars must be an integer >= 20, got ${config.summaryHeadChars}`);
  }
  if (!Number.isFinite(config.compressionRatio) || config.compressionRatio <= 0 || config.compressionRatio > 1) {
    throw new MemoryError("CONFIG", `compressionRatio must be in (0, 1], got ${config.compressionRatio}`);
  }
}

export interface NodeStats {
  node: string;
  entries: number;
  usedTokens: number;
  capacityTokens: number;
  utilization: number;
  byKind: Record<MemoryKind, number>;
  pinnedEntries: number;
  oldestEntryAt: number | null;
  newestEntryAt: number | null;
}

export interface ClusterStats {
  nodes: NodeStats[];
  nodeCount: number;
  totalEntries: number;
  totalTokens: number;
  totalCapacityTokens: number;
  utilization: number;
}

export interface CompactResult {
  node: string;
  clustersMerged: number;
  summariesCreated: number;
  entriesBefore: number;
  entriesAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  removedIds: string[];
  summaryIds: string[];
}

export interface EvictResult {
  node: string;
  evictedIds: string[];
  tokensFreed: number;
  targetTokens: number;
}

export interface NodeReport {
  node: string;
  entriesBefore: number;
  entriesAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensFreed: number;
  clustersMerged: number;
  summariesCreated: number;
  evictedIds: string[];
}

export interface ClusterReport {
  nodes: NodeReport[];
  totals: {
    entriesBefore: number;
    entriesAfter: number;
    tokensBefore: number;
    tokensAfter: number;
    tokensFreed: number;
    clustersMerged: number;
    summariesCreated: number;
    evictedCount: number;
    evictedIds: string[];
  };
}