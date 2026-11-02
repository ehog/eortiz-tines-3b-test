import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { blockSize, formatCidr, parseCidr } from "./cidr";
import { STATE_DIR } from "./config";

export interface Allocation {
  cidr: string;
  subscriptionId: string;
  rgId: string;
  rgName: string;
  vnetId: string;
  source: string;
  allocatedAt: string;
  releasedAt?: string;
  releasedBy?: string;
}

export interface Plan {
  id: string;
  createdAt: string;
  items: any[];
  summary: Record<string, unknown>;
}

export interface PlanDecision {
  planId: string;
  decision: "approve" | "reject";
  by: string;
  at: string;
  results?: Record<string, number>;
}

const PLAN_TTL_MS = 48 * 3_600_000;
const DAY_MS = 86_400_000;

export const nowIso = () => new Date().toISOString();
const stamp = () => nowIso().replace(/[-:.]/g, "");
const abs = (rel: string) => `${STATE_DIR}/${rel}`;
const cidrKey = (cidr: string) => cidr.replace("/", "_");

export function keyOf(id: string) {
  const hash = new Bun.CryptoHasher("sha1").update(id.toLowerCase()).digest("hex");
  const name = id.split("/").filter(Boolean).pop() ?? "root";
  return `${name.replace(/[^\w.-]/g, "_").slice(0, 60)}-${hash.slice(0, 16)}`;
}

export function readJson<T = any>(rel: string): T | null {
  const path = abs(rel);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function writeJson(rel: string, value: unknown) {
  const path = abs(rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 1) + "\n");
}

export function removeFile(rel: string) {
  rmSync(abs(rel), { force: true });
}

export function listNames(dir: string): string[] {
  const path = abs(dir);
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((n) => n.endsWith(".json")).sort();
}

export function readAll<T = any>(dir: string): T[] {
  return listNames(dir).map((n) => readJson<T>(`${dir}/${n}`)!);
}

export function readRecent<T = any>(dir: string, limit: number): T[] {
  return listNames(dir)
    .reverse()
    .slice(0, limit)
    .map((n) => readJson<T>(`${dir}/${n}`)!);
}

export function addRecord(dir: string, value: unknown) {
  const name = `${stamp()}-${crypto.randomUUID().slice(0, 8)}.json`;
  writeJson(`${dir}/${name}`, value);
  return name;
}

export function pruneOlderThan(dir: string, days: number) {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString().replace(/[-:.]/g, "");
  const old = listNames(dir).filter((n) => n < cutoff);
  for (const n of old) removeFile(`${dir}/${n}`);
  return old.length;
}

function lockBlocks(cidr: string, granule: number) {
  const b = parseCidr(cidr);
  if (b.prefix >= granule) {
    const size = blockSize(granule);
    return [formatCidr({ start: Math.floor(b.start / size) * size, prefix: granule })];
  }
  const out: string[] = [];
  const end = b.start + blockSize(b.prefix);
  for (let s = b.start; s < end; s += blockSize(granule)) {
    out.push(formatCidr({ start: s, prefix: granule }));
  }
  return out;
}

export function activeAllocations(): Allocation[] {
  return readAll<Allocation>("ipam/active");
}

export function allocationForRg(rgId: string): Allocation | null {
  const index = readJson<{ cidr: string }>(`ipam/by-rg/${keyOf(rgId)}.json`);
  if (!index) return null;
  const a = readJson<Allocation>(`ipam/active/${cidrKey(index.cidr)}.json`);
  return a && a.rgId.toLowerCase() === rgId.toLowerCase() ? a : null;
}

// Every allocation also writes one lock file per granule-sized block it covers,
// so overlapping concurrent claims collide on a shared path and one run fails.
export function claimAllocation(a: Allocation, granule: number) {
  writeJson(`ipam/active/${cidrKey(a.cidr)}.json`, a);
  writeJson(`ipam/by-rg/${keyOf(a.rgId)}.json`, { cidr: a.cidr });
  for (const block of lockBlocks(a.cidr, granule)) {
    writeJson(`ipam/blocks/${cidrKey(block)}.json`, { cidr: a.cidr, rgId: a.rgId });
  }
}

export function releaseAllocation(a: Allocation, by: string, granule: number) {
  removeFile(`ipam/active/${cidrKey(a.cidr)}.json`);
  removeFile(`ipam/by-rg/${keyOf(a.rgId)}.json`);
  for (const block of lockBlocks(a.cidr, granule)) {
    removeFile(`ipam/blocks/${cidrKey(block)}.json`);
  }
  const released = { ...a, releasedAt: nowIso(), releasedBy: by };
  writeJson(`ipam/released/${stamp()}-${cidrKey(a.cidr)}.json`, released);
}

export function savePlan(plan: Plan) {
  writeJson(`plans/${plan.id}.json`, plan);
}

export function readPlan(id: string): Plan | null {
  if (!/^cp-[\w-]+$/.test(id)) return null;
  return readJson<Plan>(`plans/${id}.json`);
}

export function readDecision(planId: string): PlanDecision | null {
  return readJson<PlanDecision>(`decisions/${planId}.json`);
}

export function saveDecision(d: PlanDecision) {
  writeJson(`decisions/${d.planId}.json`, d);
}

export function planStatus(plan: Plan): string {
  const d = readDecision(plan.id);
  if (d) return d.decision === "approve" ? (d.results ? "executed" : "approved") : "rejected";
  const latest = listNames("plans").pop();
  if (latest && latest !== `${plan.id}.json`) return "superseded";
  if (Date.now() - Date.parse(plan.createdAt) > PLAN_TTL_MS) return "expired";
  return "pending";
}
