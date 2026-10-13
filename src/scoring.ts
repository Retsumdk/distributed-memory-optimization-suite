import type { MemoryEntry, OptimizerConfig } from "./types.js";

export function recencyFactor(lastAccessAt: number, now: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return 1;
  const age = Math.max(0, now - lastAccessAt);
  return Math.pow(0.5, age / halfLifeMs);
}

export function frequencyFactor(accessCount: number): number {
  if (accessCount < 0) return 0;
  return Math.log2(1 + accessCount);
}

export function scoreEntry(entry: MemoryEntry, now: number, config: OptimizerConfig): number {
  const recency = recencyFactor(entry.lastAccessAt, now, config.halfLifeMs);
  const frequency = frequencyFactor(entry.accessCount);
  return (
    config.weights.recency * recency +
    config.weights.frequency * frequency +
    config.weights.importance * entry.importance
  );
}
