#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createMemoryServer } from "./server.js";
import { loadClusterState, saveClusterState } from "./persistence.js";
import { MemoryCluster } from "./cluster.js";
import { runDemo } from "./demo.js";
import { isMemoryError, MemoryError } from "./errors.js";
import type { MemoryKind } from "./types.js";

const DEFAULT_PORT = 8642;
const ADD_DEFAULT_CAPACITY = 100_000;
const KINDS: readonly string[] = ["episodic", "fact", "summary"];

const USAGE = `distributed-memory-optimization-suite

Usage:
  dmos demo                                Run the deterministic end-to-end demo
  dmos add --node <id> --content <text>    Add a memory entry
        [--tokens n] [--importance 0..1] [--kind episodic|fact|summary]
        [--agent id] [--tag t]... [--pinned]
  dmos node --node <id> --capacity <n>     Create a node with a token capacity
  dmos list [--node <id>]                  List entries (optionally per node)
  dmos stats                               Print cluster and per-node stats
  dmos optimize                            Compact + evict every node, print report
  dmos serve [--port p] [--token t]        Serve the HTTP API (default port 8642)
  dmos help                                Show this help

Global options:
  --state <file>   Load cluster state from <file> before the command and
                   persist after mutating commands (add, optimize)
  --node <id>      Target node (required for add/node, optional filter for list)

Exit codes: 0 success, 1 runtime error, 2 usage error.`;

interface CliContext {
  cluster: MemoryCluster;
  statePath?: string;
}

type ParsedOptions = {
  state?: string;
  capacity?: string;
  node?: string;
  content?: string;
  tokens?: string;
  importance?: string;
  kind?: string;
  agent?: string;
  tag?: string[];
  pinned?: boolean;
  port?: string;
  token?: string;
};

function parseNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new MemoryError("VALIDATION", `${label} must be a number, got "${value}"`);
  }
  return parsed;
}

async function openCluster(statePath: string | undefined): Promise<CliContext> {
  if (statePath === undefined) return { cluster: new MemoryCluster() };
  try {
    const cluster = await loadClusterState(statePath);
    return { cluster, statePath };
  } catch (error) {
    if (isMemoryError(error) && error.code === "NOT_FOUND") {
      return { cluster: new MemoryCluster(), statePath };
    }
    throw error;
  }
}

async function run(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const command = argv[0] as string;
  let options: ParsedOptions;
  try {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: {
        state: { type: "string" },
        capacity: { type: "string" },
      node: { type: "string" },
        content: { type: "string" },
        tokens: { type: "string" },
        importance: { type: "string" },
        kind: { type: "string" },
        agent: { type: "string" },
        tag: { type: "string", multiple: true },
        pinned: { type: "boolean", default: false },
        port: { type: "string", default: String(DEFAULT_PORT) },
        token: { type: "string" },
      },
      strict: true,
    });
    options = parsed.values as ParsedOptions;
  } catch (error) {
    process.stderr.write(`invalid options: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    return 2;
  }

  const ctx = await openCluster(options.state);
  const { cluster } = ctx;

  switch (command) {
    case "demo": {
      process.stdout.write(runDemo());
      return 0;
    }
    case "add": {
      if (options.node === undefined || options.content === undefined) {
        process.stderr.write("usage: dmos add --node <id> --content <text> [options]\n");
        return 2;
      }
      const kind = options.kind ?? "episodic";
      if (!KINDS.includes(kind)) {
        process.stderr.write(`usage: --kind must be one of ${KINDS.join("|")}\n`);
        return 2;
      }
      if (cluster.node(options.node) === undefined) {
        cluster.addNode(options.node, ADD_DEFAULT_CAPACITY);
      }
      const importance = parseNumber(options.importance, "--importance");
      const tokens = parseNumber(options.tokens, "--tokens");
      const entry = cluster.add({
        node: options.node,
        content: options.content,
        ...(options.agent !== undefined ? { agent: options.agent } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        ...(importance !== undefined ? { importance } : {}),
        kind: kind as MemoryKind,
        pinned: options.pinned ?? false,
        ...(options.tag !== undefined ? { tags: options.tag } : {}),
      });
      if (ctx.statePath !== undefined) await saveClusterState(cluster, ctx.statePath);
      process.stdout.write(
        `${JSON.stringify({ id: entry.id, node: entry.node, tokens: entry.tokens }, null, 2)}\n`,
      );
      return 0;
    }
    case "node": {
      if (options.node === undefined || options.capacity === undefined) {
        process.stderr.write("usage: dmos node --node <id> --capacity <tokens>\n");
        return 2;
      }
      const capacity = parseNumber(options.capacity, "--capacity");
      if (capacity === undefined || !Number.isInteger(capacity) || capacity < 1) {
        process.stderr.write("usage: --capacity must be an integer >= 1\n");
        return 2;
      }
      const store = cluster.addNode(options.node, capacity);
      if (ctx.statePath !== undefined) await saveClusterState(cluster, ctx.statePath);
      process.stdout.write(`${JSON.stringify(store.stats(), null, 2)}\n`);
      return 0;
    }
    case "list": {
      const stores =
        options.node === undefined ? cluster.nodes() : [cluster.node(options.node)].filter((s) => s !== undefined);
      if (options.node !== undefined && stores.length === 0) {
        throw new MemoryError("NOT_FOUND", `unknown node "${options.node}"`);
      }
      for (const store of stores) {
        for (const entry of store.entries()) {
          const flags = [entry.kind, entry.pinned ? "pinned" : null, `imp=${entry.importance}`]
            .filter((part) => part !== null)
            .join(", ");
          process.stdout.write(`${entry.id}  [${entry.node}] (${flags}) ${entry.tokens}t  ${entry.content}\n`);
        }
      }
      return 0;
    }
    case "stats": {
      process.stdout.write(`${JSON.stringify(cluster.stats(), null, 2)}\n`);
      return 0;
    }
    case "optimize": {
      const report = cluster.optimizeAll();
      if (ctx.statePath !== undefined) await saveClusterState(cluster, ctx.statePath);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    case "serve": {
      const port = parseNumber(options.port, "--port") ?? DEFAULT_PORT;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new MemoryError("VALIDATION", `--port must be an integer in [1, 65535], got ${options.port ?? ""}`);
      }
      const server = createMemoryServer(cluster, options.token === undefined ? {} : { token: options.token });
      server.listen(port, () => {
        process.stdout.write(`distributed-memory-optimization-suite listening on port ${port}\n`);
      });
      const shutdown = (): void => {
        server.close(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return 0;
    }
    default:
      process.stderr.write(`unknown command "${command}"\n\n${USAGE}\n`);
      return 2;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (error) {
    if (isMemoryError(error)) {
      process.stderr.write(`error [${error.code}]: ${error.message}\n`);
      return 1;
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exit = await main(process.argv.slice(2));
  if (exit !== 0) process.exit(exit);
}
