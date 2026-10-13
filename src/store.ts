import { MemoryError } from "./errors.js";
import type { MemoryEntry, MemoryKind, NewMemoryInput, NodeStats } from "./types.js";

export interface StoreOptions {
  clock?: () => number;
  idFactory?: () => string;
}

const KINDS: readonly MemoryKind[] = ["episodic", "fact", "summary"];

export function isMemoryKind(value: string): value is MemoryKind {
  return (KINDS as readonly string[]).includes(value);
}

export function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

export class MemoryStore {
  readonly id: string;
  capacityTokens: number;

  private readonly entriesMap = new Map<string, MemoryEntry>();
  private readonly clock: () => number;
  private readonly idFactory: () => string;
  private sequence = 0;

  constructor(id: string, capacityTokens: number, options: StoreOptions = {}) {
    if (id.trim().length === 0) {
      throw new MemoryError("VALIDATION", "node id must be a non-empty string");
    }
    if (!Number.isInteger(capacityTokens) || capacityTokens < 1) {
      throw new MemoryError(
        "VALIDATION",
        `capacityTokens must be an integer >= 1, got ${capacityTokens}`,
      );
    }
    this.id = id;
    this.capacityTokens = capacityTokens;
    this.clock = options.clock ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  nextId(): string {
    this.sequence += 1;
    return this.idFactory();
  }

  add(input: NewMemoryInput): MemoryEntry {
    if (typeof input.content !== "string" || input.content.trim().length === 0) {
      throw new MemoryError("VALIDATION", "content must be a non-empty string");
    }
    if (input.node !== undefined && input.node !== this.id) {
      throw new MemoryError(
        "VALIDATION",
        `entry declares node "${input.node}" but this store is "${this.id}"`,
      );
    }
    const tokens = input.tokens ?? estimateTokens(input.content);
    if (!Number.isInteger(tokens) || tokens < 1) {
      throw new MemoryError("VALIDATION", `tokens must be an integer >= 1, got ${tokens}`);
    }
    const importance = input.importance ?? 0.5;
    if (!Number.isFinite(importance) || importance < 0 || importance > 1) {
      throw new MemoryError("VALIDATION", `importance must be within [0, 1], got ${importance}`);
    }
    const kind = input.kind ?? "episodic";
    if (!isMemoryKind(kind)) {
      throw new MemoryError("VALIDATION", `unknown memory kind "${kind}"`);
    }
    const now = this.clock();
    const id = input.id ?? this.nextId();
    if (this.entriesMap.has(id)) {
      throw new MemoryError("CONFLICT", `entry id "${id}" already exists on node ${this.id}`);
    }
    const entry: MemoryEntry = {
      id,
      node: this.id,
      agent: input.agent ?? "default",
      content: input.content,
      tokens,
      kind,
      importance,
      createdAt: input.createdAt ?? now,
      lastAccessAt: input.lastAccessAt ?? input.createdAt ?? now,
      accessCount: input.accessCount ?? 0,
      pinned: input.pinned ?? false,
      sources: [...(input.sources ?? [])].sort(),
      tags: [...(input.tags ?? [])].sort(),
    };
    this.entriesMap.set(id, entry);
    return entry;
  }

  insert(entry: MemoryEntry): MemoryEntry {
    if (entry.node !== this.id) {
      throw new MemoryError(
        "VALIDATION",
        `entry declares node "${entry.node}" but this store is "${this.id}"`,
      );
    }
    if (this.entriesMap.has(entry.id)) {
      throw new MemoryError("CONFLICT", `entry id "${entry.id}" already exists on node ${this.id}`);
    }
    if (!Number.isInteger(entry.tokens) || entry.tokens < 1) {
      throw new MemoryError("VALIDATION", `tokens must be an integer >= 1, got ${entry.tokens}`);
    }
    if (!isMemoryKind(entry.kind)) {
      throw new MemoryError("VALIDATION", `unknown memory kind "${entry.kind}"`);
    }
    const inserted: MemoryEntry = {
      ...entry,
      sources: [...entry.sources].sort(),
      tags: [...entry.tags].sort(),
    };
    this.entriesMap.set(inserted.id, inserted);
    return inserted;
  }

  get(id: string): MemoryEntry | undefined {
    return this.entriesMap.get(id);
  }

  touch(id: string): boolean {
    const entry = this.entriesMap.get(id);
    if (entry === undefined) return false;
    entry.lastAccessAt = this.clock();
    entry.accessCount += 1;
    return true;
  }

  remove(id: string): boolean {
    return this.entriesMap.delete(id);
  }

  setPinned(id: string, pinned: boolean): boolean {
    const entry = this.entriesMap.get(id);
    if (entry === undefined) return false;
    entry.pinned = pinned;
    return true;
  }

  entries(): MemoryEntry[] {
    return [...this.entriesMap.values()].sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt - b.createdAt,
    );
  }

  usedTokens(): number {
    let total = 0;
    for (const entry of this.entriesMap.values()) total += entry.tokens;
    return total;
  }

  utilization(): number {
    return this.usedTokens() / this.capacityTokens;
  }

  stats(): NodeStats {
    const byKind: Record<MemoryKind, number> = { episodic: 0, fact: 0, summary: 0 };
    let pinned = 0;
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const entry of this.entriesMap.values()) {
      byKind[entry.kind] += 1;
      if (entry.pinned) pinned += 1;
      if (oldest === null || entry.createdAt < oldest) oldest = entry.createdAt;
      if (newest === null || entry.createdAt > newest) newest = entry.createdAt;
    }
    return {
      node: this.id,
      entries: this.entriesMap.size,
      usedTokens: this.usedTokens(),
      capacityTokens: this.capacityTokens,
      utilization: this.utilization(),
      byKind,
      pinnedEntries: pinned,
      oldestEntryAt: oldest,
      newestEntryAt: newest,
    };
  }
}
