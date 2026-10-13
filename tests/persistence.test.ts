import { describe, expect, test } from "bun:test";
import { MemoryCluster } from "../src/cluster.js";
import { loadClusterState, saveClusterState } from "../src/persistence.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const T0 = 1_700_000_000_000;

function demoCluster(): MemoryCluster {
  let sequence = 0;
  const cluster = new MemoryCluster(undefined, {
    clock: () => T0,
    idFactory: () => {
      sequence += 1;
      return `m${sequence}`;
    },
  });
  const alpha = cluster.addNode("alpha", 500);
  alpha.add({ node: "alpha", content: "queue depth alert on worker-1", tokens: 10, importance: 0.4 });
  alpha.add({ node: "alpha", content: "queue depth alert on worker-2", tokens: 10, importance: 0.4 });
  return cluster;
}

describe("persistence", () => {
  test("save then load restores config, nodes, and entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmos-"));
    const path = join(dir, "state.json");
    const cluster = demoCluster();
    await saveClusterState(cluster, path);

    const restored = await loadClusterState(path);
    expect(restored.config).toEqual(DEFAULT_CONFIG);
    expect(restored.stats().nodeCount).toBe(1);
    expect(restored.stats().totalEntries).toBe(2);
    expect(restored.stats().totalTokens).toBe(20);

    const entry = restored.get("m1");
    expect(entry?.content).toBe("queue depth alert on worker-1");
    expect(entry?.node).toBe("alpha");
  });

  test("state file uses an atomic write and contains a versioned envelope", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmos-"));
    const path = join(dir, "state.json");
    await saveClusterState(demoCluster(), path);

    // Atomic write: the tmp file is renamed away, and only the final state remains.
    const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp-"));
    expect(leftovers).toEqual([]);
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(parsed["version"]).toBe(1);
    expect(Array.isArray(parsed["nodes"])).toBe(true);
  });

  test("load rejects invalid JSON as CORRUPTION", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmos-"));
    const path = join(dir, "state.json");
    await Bun.write(path, "{not json");
    try {
      await loadClusterState(path);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("not valid JSON");
    }
  });

  test("load rejects unknown state versions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmos-"));
    const path = join(dir, "state.json");
    await Bun.write(path, JSON.stringify({ version: 99, savedAt: T0, config: {}, nodes: [] }));
    try {
      await loadClusterState(path);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("unsupported state version 99");
    }
  });

  test("load rejects malformed node states", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmos-"));
    const path = join(dir, "state.json");
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        savedAt: T0,
        config: DEFAULT_CONFIG,
        nodes: [{ id: "alpha", capacityTokens: "many", entries: [] }],
      }),
    );
    try {
      await loadClusterState(path);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("malformed");
    }
  });

  test("load reports a missing state file as NOT_FOUND", async () => {
    try {
      await loadClusterState(join(tmpdir(), "dmos-missing", "nope.json"));
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("cannot read state file");
    }
  });
});
