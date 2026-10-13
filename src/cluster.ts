import { MemoryError } from "./errors.js";
import { optimizeStore } from "./optimizer.js";
import { MemoryStore, type StoreOptions } from "./store.js";
import {
  DEFAULT_CONFIG,
  validateConfig,
  type ClusterReport,
  type ClusterStats,
  type MemoryEntry,
  type NewMemoryInput,
  type NodeReport,
  type OptimizerConfig,
} from "./types.js";

export interface ClusterOptions extends StoreOptions {}

export class MemoryCluster {
  private readonly nodesMap = new Map<string, MemoryStore>();
  readonly config: OptimizerConfig;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(config: Partial<OptimizerConfig> = {}, options: ClusterOptions = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    validateConfig(this.config);
    this.clock = options.clock ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  addNode(id: string, capacityTokens: number): MemoryStore {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new MemoryError("VALIDATION", "node id must be a non-empty string");
    }
    if (this.nodesMap.has(trimmed)) {
      throw new MemoryError("CONFLICT", `node "${trimmed}" already exists`);
    }
    const store = new MemoryStore(trimmed, capacityTokens, {
      clock: this.clock,
      idFactory: this.idFactory,
    });
    this.nodesMap.set(trimmed, store);
    return store;
  }

  node(id: string): MemoryStore | undefined {
    return this.nodesMap.get(id);
  }

  nodes(): MemoryStore[] {
    return [...this.nodesMap.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  add(input: NewMemoryInput): MemoryEntry {
    const store = this.nodesMap.get(input.node);
    if (store === undefined) {
      throw new MemoryError("NOT_FOUND", `unknown node "${input.node}"`);
    }
    return store.add(input);
  }

  get(id: string): MemoryEntry | undefined {
    for (const store of this.nodesMap.values()) {
      const entry = store.get(id);
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  optimizeAll(): ClusterReport {
    const reports: NodeReport[] = [];
    for (const store of this.nodes()) {
      reports.push(optimizeStore(store, this.config, this.clock()));
    }
    const totals = {
      entriesBefore: reports.reduce((sum, report) => sum + report.entriesBefore, 0),
      entriesAfter: reports.reduce((sum, report) => sum + report.entriesAfter, 0),
      tokensBefore: reports.reduce((sum, report) => sum + report.tokensBefore, 0),
      tokensAfter: reports.reduce((sum, report) => sum + report.tokensAfter, 0),
      tokensFreed: reports.reduce((sum, report) => sum + report.tokensFreed, 0),
      clustersMerged: reports.reduce((sum, report) => sum + report.clustersMerged, 0),
      summariesCreated: reports.reduce((sum, report) => sum + report.summariesCreated, 0),
      evictedCount: reports.reduce((sum, report) => sum + report.evictedIds.length, 0),
      evictedIds: reports.flatMap((report) => report.evictedIds),
    };
    return { nodes: reports, totals };
  }

  stats(): ClusterStats {
    const nodeStats = this.nodes().map((store) => store.stats());
    const totalEntries = nodeStats.reduce((sum, node) => sum + node.entries, 0);
    const totalTokens = nodeStats.reduce((sum, node) => sum + node.usedTokens, 0);
    const totalCapacityTokens = nodeStats.reduce((sum, node) => sum + node.capacityTokens, 0);
    return {
      nodes: nodeStats,
      nodeCount: nodeStats.length,
      totalEntries,
      totalTokens,
      totalCapacityTokens,
      utilization: totalCapacityTokens === 0 ? 0 : totalTokens / totalCapacityTokens,
    };
  }
}
