import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MemoryError } from "./errors.js";
import { MemoryCluster, type ClusterOptions } from "./cluster.js";
import type { MemoryEntry, MemoryKind, OptimizerConfig } from "./types.js";

const STATE_VERSION = 1;

interface NodeState {
  id: string;
  capacityTokens: number;
  entries: MemoryEntry[];
}

interface ClusterState {
  version: number;
  savedAt: number;
  config: OptimizerConfig;
  nodes: NodeState[];
}

const KINDS: readonly MemoryKind[] = ["episodic", "fact", "summary"];

function validateState(state: unknown): ClusterState {
  if (typeof state !== "object" || state === null) {
    throw new MemoryError("CORRUPTION", "state file must contain a JSON object");
  }
  const record = state as Record<string, unknown>;
  if (record["version"] !== STATE_VERSION) {
    throw new MemoryError(
      "CORRUPTION",
      `unsupported state version ${String(record["version"])}, expected ${STATE_VERSION}`,
    );
  }
  if (typeof record["savedAt"] !== "number" || typeof record["config"] !== "object" || record["config"] === null) {
    throw new MemoryError("CORRUPTION", "state file is missing savedAt or config");
  }
  if (!Array.isArray(record["nodes"])) {
    throw new MemoryError("CORRUPTION", "state file must contain a nodes array");
  }
  const config = record["config"] as OptimizerConfig;
  const nodes: NodeState[] = [];
  for (const raw of record["nodes"] as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      throw new MemoryError("CORRUPTION", "node state must be an object");
    }
    const node = raw as Record<string, unknown>;
    if (typeof node["id"] !== "string" || typeof node["capacityTokens"] !== "number" || !Array.isArray(node["entries"])) {
      throw new MemoryError("CORRUPTION", `node state for ${String(node["id"])} is malformed`);
    }
    for (const entry of node["entries"] as unknown[]) {
      if (typeof entry !== "object" || entry === null) {
        throw new MemoryError("CORRUPTION", `node ${node["id"]} contains a malformed entry`);
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate["id"] !== "string" || typeof candidate["content"] !== "string" || !KINDS.includes(candidate["kind"] as MemoryKind)) {
        throw new MemoryError("CORRUPTION", `node ${node["id"]} contains an entry with invalid id/content/kind`);
      }
    }
    nodes.push(node as unknown as NodeState);
  }
  return { version: STATE_VERSION, savedAt: record["savedAt"] as number, config, nodes };
}

export async function saveClusterState(cluster: MemoryCluster, path: string): Promise<void> {
  const state: ClusterState = {
    version: STATE_VERSION,
    savedAt: Date.now(),
    config: cluster.config,
    nodes: cluster.nodes().map((store) => ({
      id: store.id,
      capacityTokens: store.capacityTokens,
      entries: store.entries(),
    })),
  };
  const directory = dirname(path);
  if (directory.length > 0) await mkdir(directory, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmp, path);
}

export async function loadClusterState(path: string, options: ClusterOptions = {}): Promise<MemoryCluster> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    throw new MemoryError(
      "NOT_FOUND",
      `cannot read state file ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new MemoryError("CORRUPTION", `state file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const state = validateState(parsed);
  const cluster = new MemoryCluster(state.config, options);
  for (const nodeState of state.nodes) {
    cluster.addNode(nodeState.id, nodeState.capacityTokens);
    const store = cluster.node(nodeState.id);
    if (store === undefined) {
      throw new MemoryError("CORRUPTION", `failed to restore node ${nodeState.id}`);
    }
    for (const entry of nodeState.entries) {
      store.insert(entry);
    }
  }
  return cluster;
}
