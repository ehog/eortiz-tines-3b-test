/** Deterministic helpers so a demo run produces stable-but-varied mock activity. */
export type Rng = () => number;

export function makeRng(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function choice<T>(rng: Rng, items: T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

export function timeIn(rng: Rng, start: Date, end: Date): string {
  const span = end.getTime() - start.getTime();
  return new Date(start.getTime() + Math.floor(rng() * span)).toISOString();
}

export const USERS = [
  "dana.reyes",
  "sam.oyelaran",
  "priya.nair",
  "tom.becker",
  "lena.fischer",
  "svc_backup",
  "marc.duval",
];

export const HOSTS = [
  "pay-db-01",
  "pay-app-02",
  "ehr-prod-03",
  "dc-core-01",
  "vpn-gw-01",
  "hr-files-04",
  "build-agent-11",
  "kiosk-lobby-07",
  "lap-lf-2291",
  "lap-td-8830",
];

export type MockWindow = { start: Date; end: Date; rng: Rng };
