import { MemoryError } from "./errors.js";
import { scoreEntry } from "./scoring.js";
import { textSimilarity } from "./similarity.js";
import type { MemoryStore } from "./store.js";
import type { CompactResult, MemoryEntry, OptimizerConfig } from "./types.js";

export interface ClusterGroup {
  members: MemoryEntry[];
  representative: string;
}

export function compactStore(
  store: MemoryStore,
  config: OptimizerConfig,
  now: number,
): CompactResult {
  const entriesBefore = store.stats().entries;
  const tokensBefore = store.usedTokens();
  const candidates = store
    .entries()
    .filter((entry) => !entry.pinned)
    .sort((a, b) => {
      const delta = scoreEntry(b, now, config) - scoreEntry(a, now, config);
      if (delta !== 0) return delta;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const assigned = new Set<string>();
  const groups: ClusterGroup[] = [];

  for (const seed of candidates) {
    if (assigned.has(seed.id)) continue;
    const members = [seed];
    for (const other of candidates) {
      if (other.id === seed.id || assigned.has(other.id)) continue;
      if (textSimilarity(seed.content, other.content) >= config.similarityThreshold) {
        members.push(other);
      }
    }
    for (const member of members) assigned.add(member.id);
    if (members.length >= config.minClusterSize) {
      groups.push({ members, representative: pickRepresentative(members, config, now) });
    }
  }

  const removedIds: string[] = [];
  const summaries: MemoryEntry[] = [];

  for (const group of groups) {
    const summary = buildSummary(store, group.members, config, now);
    for (const member of group.members) {
      store.remove(member.id);
      removedIds.push(member.id);
    }
    summaries.push(store.insert(summary));
  }

  return {
    node: store.id,
    clustersMerged: groups.length,
    summariesCreated: summaries.length,
    entriesBefore,
    entriesAfter: store.stats().entries,
    tokensBefore,
    tokensAfter: store.usedTokens(),
    removedIds: removedIds.sort(),
    summaryIds: summaries.map((summary) => summary.id),
  };
}

function pickRepresentative(
  members: readonly MemoryEntry[],
  config: OptimizerConfig,
  now: number,
): string {
  let best = members[0] as MemoryEntry;
  let bestScore = -1;
  for (const member of members) {
    const score = scoreEntry(member, now, config);
    if (score > bestScore || (score === bestScore && member.id < best.id)) {
      best = member;
      bestScore = score;
    }
  }
  return best.id;
}

function buildSummary(
  store: MemoryStore,
  members: readonly MemoryEntry[],
  config: OptimizerConfig,
  now: number,
): MemoryEntry {
  if (members.length < config.minClusterSize) {
    throw new MemoryError(
      "VALIDATION",
      `summary requires >= ${config.minClusterSize} members, got ${members.length}`,
    );
  }
  const ordered = [...members].sort((a, b) => {
    const delta = scoreEntry(b, now, config) - scoreEntry(a, now, config);
    if (delta !== 0) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const parts: string[] = [];
  let budget = config.summaryHeadChars;
  for (const member of ordered) {
    if (budget <= 0) break;
    const head = member.content.slice(0, Math.min(member.content.length, budget));
    parts.push(head);
    budget -= head.length;
  }
  const totalTokens = ordered.reduce((sum, member) => sum + member.tokens, 0);
  const summaryTokens = Math.max(1, Math.ceil(totalTokens * config.compressionRatio));
  const agentCounts = new Map<string, number>();
  for (const member of ordered) {
    agentCounts.set(member.agent, (agentCounts.get(member.agent) ?? 0) + 1);
  }
  let agent = "default";
  let agentCount = -1;
  for (const candidate of [...agentCounts.keys()].sort()) {
    const count = agentCounts.get(candidate) ?? 0;
    if (count > agentCount) {
      agent = candidate;
      agentCount = count;
    }
  }
  const tagSet = new Set<string>();
  for (const member of ordered) {
    for (const tag of member.tags) tagSet.add(tag);
  }
  return {
    id: store.nextId(),
    node: store.id,
    agent,
    content: parts.join(" | "),
    tokens: summaryTokens,
    kind: "summary",
    importance: Math.max(...ordered.map((member) => member.importance)),
    createdAt: Math.min(...ordered.map((member) => member.createdAt)),
    lastAccessAt: Math.max(...ordered.map((member) => member.lastAccessAt)),
    accessCount: ordered.reduce((sum, member) => sum + member.accessCount, 0),
    pinned: false,
    sources: ordered.map((member) => member.id).sort(),
    tags: [...tagSet].sort(),
  };
}
