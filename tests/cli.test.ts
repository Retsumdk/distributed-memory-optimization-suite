import { describe, expect, test } from "bun:test";
import { main } from "../src/cli.js";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function writeStdout(spied: { toString(): string }): string {
  return spied.toString();
}

describe("cli", () => {
  test("help exits 0 and lists commands", async () => {
    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const exit = await main(["help"]);
      expect(exit).toBe(0);
    } finally {
      process.stdout.write = original;
    }
    const output = writeStdout({ toString: () => chunks.join("") });
    expect(output).toContain("dmos demo");
    expect(output).toContain("Exit codes");
  });

  test("unknown command exits 2", async () => {
    const chunks: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      const exit = await main(["frobnicate"]);
      expect(exit).toBe(2);
    } finally {
      process.stderr.write = original;
    }
    expect(chunks.join("")).toContain('unknown command "frobnicate"');
  });

  test("demo prints the deterministic transcript", async () => {
    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const exit = await main(["demo"]);
      expect(exit).toBe(0);
    } finally {
      process.stdout.write = original;
    }
    const output = writeStdout({ toString: () => chunks.join("") });
    expect(output).toContain("seeded 9 entries across 2 nodes");
    expect(output).toContain("cluster totals:");
    expect(output).toContain("sources=");
  });

  test("add + stats + optimize with --state persists end to end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmos-cli-"));
    const state = join(dir, "state.json");
    try {
      const add = await main(["add", "--state", state, "--node", "alpha", "--content", "pin this"]);
      expect(add).toBe(0);

      const saved = JSON.parse(readFileSync(state, "utf-8")) as { nodes: unknown[] };
      expect(saved.nodes).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
