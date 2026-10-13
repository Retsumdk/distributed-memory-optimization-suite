import { describe, expect, test } from "bun:test";
import { createMemoryServer } from "../src/server.js";
import { MemoryCluster } from "../src/cluster.js";
import type { AddressInfo } from "node:net";

const T0 = 1_700_000_000_000;

function startedServer(token?: string): { url: string; close: () => Promise<void> } {
  let sequence = 0;
  const cluster = new MemoryCluster(undefined, {
    clock: () => T0,
    idFactory: () => {
      sequence += 1;
      return `m${sequence}`;
    },
  });
  cluster.addNode("alpha", 500);
  const server = createMemoryServer(cluster, token === undefined ? {} : { token });
  server.listen(0, "127.0.0.1");
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function jsonRequest(
  url: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as unknown;
  return { status: response.status, data };
}

describe("memory server", () => {
  test("healthz and stats are open reads", async () => {
    const { url, close } = startedServer();
    try {
      const health = await jsonRequest(url, "GET", "/healthz");
      expect(health.status).toBe(200);
      expect(health.data).toEqual({ ok: true });

      const stats = await jsonRequest(url, "GET", "/stats");
      expect(stats.status).toBe(200);
      const record = stats.data as { nodeCount: number; totalCapacityTokens: number };
      expect(record.nodeCount).toBe(1);
      expect(record.totalCapacityTokens).toBe(500);
    } finally {
      await close();
    }
  });

  test("mutations require the bearer token when configured", async () => {
    const { url, close } = startedServer("secret-token");
    try {
      const unauthorized = await jsonRequest(url, "POST", "/entries", {
        node: "alpha",
        content: "no token",
      });
      expect(unauthorized.status).toBe(401);

      const rejected = await jsonRequest(url, "POST", "/entries", { node: "alpha", content: "bad" }, {
        authorization: "Bearer wrong",
      });
      expect(rejected.status).toBe(401);
    } finally {
      await close();
    }
  });

  test("authenticated add, touch, delete, and optimize round-trip", async () => {
    const { url, close } = startedServer("secret-token");
    const headers = { authorization: "Bearer secret-token" };
    try {
      const added = await jsonRequest(url, "POST", "/entries", { node: "alpha", content: "first" }, headers);
      expect(added.status).toBe(201);
      const first = added.data as { id: string };
      expect(first.id).toBe("m1");

      const second = await jsonRequest(url, "POST", "/entries", { node: "alpha", content: "first again" }, headers);
      expect(second.status).toBe(201);

      const touched = await jsonRequest(url, "POST", `/entries/${first.id}/touch`, undefined, headers);
      expect(touched.status).toBe(200);
      expect((touched.data as { accessCount: number }).accessCount).toBe(1);

      const listed = await jsonRequest(url, "GET", "/entries?node=alpha");
      expect((listed.data as { count: number }).count).toBe(2);

      const optimized = await jsonRequest(url, "POST", "/optimize", undefined, headers);
      expect(optimized.status).toBe(200);
      const report = optimized.data as { totals: { clustersMerged: number } };
      expect(report.totals.clustersMerged).toBe(1);

      // Compaction consumed the source entries (m1, m2) and left one summary behind.
      const afterOptimize = await jsonRequest(url, "GET", "/entries?node=alpha");
      const remaining = (afterOptimize.data as { entries: { id: string }[] }).entries;
      expect(remaining.length).toBe(1);
      const survivor = remaining[0] as { id: string };
      expect(survivor.id).toBe("m3");

      const removed = await jsonRequest(url, "DELETE", `/entries/${survivor.id}`, undefined, headers);
      expect(removed.status).toBe(200);
      expect((removed.data as { removed: boolean }).removed).toBe(true);
    } finally {
      await close();
    }
  });

  test("malformed payloads produce 400 with a VALIDATION error body", async () => {
    const { url, close } = startedServer();
    try {
      const missingNode = await jsonRequest(url, "POST", "/entries", { content: "orphan" });
      expect(missingNode.status).toBe(404);

      const badImportance = await jsonRequest(url, "POST", "/entries", {
        node: "alpha",
        content: "x",
        importance: 12,
      });
      expect(badImportance.status).toBe(400);
      expect((badImportance.data as { error: string }).error).toBe("VALIDATION");

      const raw = await fetch(`${url}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{oops",
      });
      expect(raw.status).toBe(400);
      const body = (await raw.json()) as { error: string };
      expect(body.error).toBe("VALIDATION");
    } finally {
      await close();
    }
  });

  test("adding a node via the API and unknown routes 404", async () => {
    const { url, close } = startedServer();
    try {
      const node = await jsonRequest(url, "POST", "/nodes", { id: "beta", capacityTokens: 300 });
      expect(node.status).toBe(201);

      const duplicate = await jsonRequest(url, "POST", "/nodes", { id: "beta", capacityTokens: 300 });
      expect(duplicate.status).toBe(409);

      const missing = await jsonRequest(url, "GET", "/nope");
      expect(missing.status).toBe(404);
    } finally {
      await close();
    }
  });
});
