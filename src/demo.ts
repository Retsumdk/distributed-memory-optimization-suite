import { MemoryCluster } from "./cluster.js";

const T0 = 1_700_000_000_000;
const SIX_HOURS = 6 * 60 * 60 * 1000;
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

export function runDemo(): string {
  const lines: string[] = [];
  let clockNow = T0;
  let sequence = 0;
  const cluster = new MemoryCluster(undefined, {
    clock: () => clockNow,
    idFactory: () => {
      sequence += 1;
      return `m${sequence}`;
    },
  });

  const alpha = cluster.addNode("alpha", 140);
  const beta = cluster.addNode("beta", 110);
  lines.push("distributed-memory-optimization-suite demo");
  lines.push("nodes: alpha (capacity 140 tokens), beta (capacity 110 tokens)");
  lines.push("");

  const seed = [
    { store: alpha, content: "Retrieval hit-rate for the product KB dropped to 62% this week", tokens: 40, importance: 0.9, createdAt: T0, agent: "research-bot", tag: "retrieval" },
    { store: alpha, content: "Retrieval hit-rate for the product KB dropped to 61 percent this week", tokens: 42, importance: 0.85, createdAt: T0 + 60_000, agent: "research-bot", tag: "retrieval" },
    { store: alpha, content: "User cohort C-14 churned after the pricing change", tokens: 30, importance: 0.6, createdAt: T0 + 120_000, agent: "research-bot", tag: "growth" },
    { store: alpha, content: "Escalation runbook lives at /runbooks/escalation", tokens: 25, importance: 1.0, createdAt: T0 + 180_000, agent: "research-bot", tag: "runbook", pinned: true, kind: "fact" as const },
    { store: alpha, content: "Cache warm-up job takes ~90s on the staging cluster", tokens: 30, importance: 0.3, createdAt: T0 - THREE_DAYS, agent: "research-bot", tag: "infra" },
    { store: beta, content: "Retry storm detected on payments-worker at 03:12 UTC", tokens: 35, importance: 0.8, createdAt: T0 + 240_000, agent: "ops-bot", tag: "incident" },
    { store: beta, content: "Retry storm detected on payments-worker around 03:14 UTC", tokens: 36, importance: 0.75, createdAt: T0 + 300_000, agent: "ops-bot", tag: "incident" },
    { store: beta, content: "Deploy 2026-10-12 rolled back; memory leak in worker pool", tokens: 38, importance: 0.7, createdAt: T0 + 360_000, agent: "ops-bot", tag: "deploy" },
    { store: beta, content: "Weekly ops digest: 14 incidents, 2 rollbacks", tokens: 28, importance: 0.2, createdAt: T0 - THREE_DAYS, agent: "ops-bot", tag: "digest" },
  ];

  for (const item of seed) {
    item.store.add({
      node: item.store.id,
      agent: item.agent,
      content: item.content,
      tokens: item.tokens,
      importance: item.importance,
      createdAt: item.createdAt,
      pinned: item.pinned ?? false,
      kind: item.kind ?? "episodic",
      tags: [item.tag],
    });
  }
  lines.push(`seeded ${seed.length} entries across 2 nodes`);
  lines.push(`alpha: ${alpha.usedTokens()}/140 tokens | beta: ${beta.usedTokens()}/110 tokens`);
  lines.push("");

  clockNow = T0 + SIX_HOURS;
  alpha.touch("m1");
  beta.touch("m6");
  lines.push("advanced clock by 6h; touched the freshest entry on each node");
  lines.push("");

  const report = cluster.optimizeAll();
  for (const node of report.nodes) {
    lines.push(
      `node ${node.node}: entries ${node.entriesBefore} -> ${node.entriesAfter}, ` +
        `tokens ${node.tokensBefore} -> ${node.tokensAfter} (freed ${node.tokensFreed}), ` +
        `clusters merged ${node.clustersMerged}, summaries created ${node.summariesCreated}, evicted ${node.evictedIds.length}`,
    );
    if (node.evictedIds.length > 0) {
      lines.push(`  evicted: ${node.evictedIds.join(", ")}`);
    }
  }
  const totals = report.totals;
  lines.push("");
  lines.push(
    `cluster totals: entries ${totals.entriesBefore} -> ${totals.entriesAfter}, ` +
      `tokens ${totals.tokensBefore} -> ${totals.tokensAfter} (freed ${totals.tokensFreed}), ` +
      `clusters merged ${totals.clustersMerged}, summaries ${totals.summariesCreated}, evicted ${totals.evictedIds.length}`,
  );
  lines.push("");

  const stats = cluster.stats();
  for (const node of stats.nodes) {
    const kinds = Object.entries(node.byKind)
      .map(([kind, count]) => `${kind}=${count}`)
      .join(", ");
    lines.push(
      `${node.node}: ${node.entries} entries, ${node.usedTokens}/${node.capacityTokens} tokens ` +
        `(${(node.utilization * 100).toFixed(1)}% utilized), ${kinds}, pinned=${node.pinnedEntries}`,
    );
  }
  lines.push("");
  lines.push("retained summaries carry provenance:");
  for (const store of cluster.nodes()) {
    for (const entry of store.entries()) {
      if (entry.kind === "summary") {
        lines.push(`  ${entry.id} (${entry.node}) sources=[${entry.sources.join(", ")}] tokens=${entry.tokens}`);
        lines.push(`    "${entry.content}"`);
      }
    }
  }
  return lines.join("\n") + "\n";
}
