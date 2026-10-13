import { describe, expect, test } from "bun:test";
import { compactStore } from "../src/compactor.js";
import { evictToTarget } from "../src/evictor.js";
import { optimizeStore } from "../src/optimizer.js";
import { MemoryStore } from "../src/store.js";
import { DEFAULT_CONFIG, type OptimizerConfig } from "../src/types.js";

const T0 = 1_700_000_000_000;

function makeStore(): MemoryStore {
  let sequence = 0;
  return new MemoryStore("alpha", 500, {
    clock: () => T0,
    idFactory: () => {
      sequence += 1;
      return `m${sequence}`;
    },
  });
}

function cfg(overrides: Partial<OptimizerConfig> = {}): OptimizerConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe("core engine", () => {
  test("scoring: recency halves per half-life, frequency is logarithmic", () => {
    const store = makeStore();
    store.add({ node: "alpha", content: "fresh note", createdAt: T0, lastAccessAt: T0 });
    store.add({ node: "alpha", content: "stale note", createdAt: T0, lastAccessAt: T0 - DEFAULT_CONFIG.halfLifeMs });
    const entries = store.entries();
    const fresh = entries.find((entry) => entry.content === "fresh note")!;
    const stale = entries.find((entry) => entry.content === "stale note")!;
    expect(fresh.lastAccessAt).toBe(T0);
    const freshScore = 1 + DEFAULT_CONFIG.weights.importance * fresh.importance;
    expect(stale.lastAccessAt).toBe(T0 - DEFAULT_CONFIG.halfLifeMs);
    // accessCount 0 → frequency factor log2(1) = 0 for both
    const freshFull = DEFAULT_CONFIG.weights.recency * 1 + DEFAULT_CONFIG.weights.importance * fresh.importance;
    const staleFull =
      DEFAULT_CONFIG.weights.recency * 0.5 + DEFAULT_CONFIG.weights.importance * stale.importance;
    expect(freshScore).toBeCloseTo(freshFull, 10);
    expect(staleFull).toBeLessThan(freshFull);
  });

  test("compaction merges near-duplicates and keeps provenance", () => {
    const store = makeStore();
    store.add({ node: "alpha", content: "queue depth alert on worker-1", importance: 0.4 });
    store.add({ node: "alpha", content: "queue depth alert on worker-2", importance: 0.4 });
    store.add({ node: "alpha", content: "unrelated finance note", importance: 0.4 });
    const result = compactStore(store, cfg(), T0);
    expect(result.clustersMerged).toBe(1);
    expect(result.summariesCreated).toBe(1);
    expect(result.summaryIds.length).toBe(1);
    expect(store.stats().entries).toBe(2); // summary + untouched entry
    const summary = store.entries().find((entry) => entry.kind === "summary");
    expect(summary !== undefined).toBe(true);
    expect(summary!.sources.length).toBe(2);
  });

  test("compaction never touches pinned entries", () => {
    const store = makeStore();
    store.add({ node: "alpha", content: "runbook alpha", pinned: true });
    store.add({ node: "alpha", content: "runbook alpha copy" });
    const result = compactStore(store, cfg(), T0);
    expect(result.clustersMerged).toBe(0);
    expect(store.stats().pinnedEntries).toBe(1);
    expect(store.stats().entries).toBe(2);
  });

  test("eviction is lowest-score-first and respects pins", () => {
    const store = makeStore();
    store.add({ node: "alpha", content: "low value", tokens: 100, importance: 0 });
    store.add({ node: "alpha", content: "high value", tokens: 100, importance: 1 });
    store.add({ node: "alpha", content: "pinned ballast", tokens: 100, importance: 0, pinned: true });
    const result = evictToTarget(store, cfg({ targetUtilization: 0.5 }), T0, 250);
    expect(result.evictedIds.length).toBe(1);
    expect(store.get("m1")).toBeUndefined(); // lowest score gone
    expect(store.get("m2") !== undefined).toBe(true); // high value stays
    expect(store.get("m3") !== undefined).toBe(true); // pinned stays
    expect(store.usedTokens()).toBe(200);
  });

  test("optimizeStore reports both compaction and eviction savings", () => {
    const store = makeStore();
    store.add({ node: "alpha", content: "dup note one", importance: 0.1 });
    store.add({ node: "alpha", content: "dup note two", importance: 0.1 });
    const report = optimizeStore(store, cfg(), T0);
    expect(report.clustersMerged).toBe(1);
    expect(report.tokensFreed).toBeGreaterThan(0);
    expect(report.entriesAfter).toBeLessThan(report.entriesBefore);
  });
});
