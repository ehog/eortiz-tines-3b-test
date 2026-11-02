import type { Entities, Incident, LogRecord, TimelineEvent } from "./lib";

export interface CollectContext {
  incident: Incident;
  entities: Entities;
  audit: { log: (event: string, target: string, outcome: string, durationMs?: number) => void; records: LogRecord[] };
}

export interface CollectResult {
  data: Record<string, unknown>;
  events: Omit<TimelineEvent, "id" | "source">[];
  recordCount: number;
}

/** Deterministic per-investigation randomness keeps mock runs reproducible across retries. */
export function seeded(seed: string) {
  let state = 0;
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) % 2147483647;
  if (state <= 0) state += 2147483646;
  return {
    next(): number {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    },
    int(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(this.next() * items.length)];
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fallback(values: string[], placeholder: string): string {
  return values.find((value) => value && value.trim()) ?? placeholder;
}
