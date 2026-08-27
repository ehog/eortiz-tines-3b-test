import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";

export const DB_DIR = "/storage/iochunt";
export const DB_PATH = `${DB_DIR}/hunts.db`;
export const FINDINGS_DIR = `${DB_DIR}/findings`;

export const SOURCES = [
  { key: "defender", label: "Microsoft Defender" },
  { key: "sentinel", label: "Microsoft Sentinel" },
  { key: "proofpoint", label: "Proofpoint" },
  { key: "zscaler", label: "Zscaler" },
] as const;

export type DemoMode = "random" | "hits" | "clean" | "error";

// In "Force one source error" demo mode this source is the one that fails.
export const FORCED_ERROR_SOURCE = "sentinel";

export function openDb(mode: "read" | "write"): Database {
  if (mode === "write") mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH, mode === "read" ? { readonly: true } : { create: true });
  db.exec("PRAGMA busy_timeout = 15000");
  if (mode === "write") migrate(db);
  return db;
}

export function dbExists(): boolean {
  return existsSync(DB_PATH);
}

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hunts (
      id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      demo_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_token TEXT NOT NULL,
      combined_at TEXT,
      report_json TEXT,
      sn_number TEXT,
      sn_sys_id TEXT,
      sn_created_at TEXT,
      findings_path TEXT
    );
    CREATE TABLE IF NOT EXISTS indicators (
      hunt_id TEXT NOT NULL,
      value TEXT NOT NULL,
      type TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (hunt_id, value)
    );
    CREATE TABLE IF NOT EXISTS source_results (
      hunt_id TEXT NOT NULL,
      source TEXT NOT NULL,
      indicator TEXT NOT NULL,
      status TEXT NOT NULL,
      error_reason TEXT,
      findings_json TEXT,
      first_seen TEXT,
      last_seen TEXT,
      frequency INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (hunt_id, source, indicator)
    );
    CREATE TABLE IF NOT EXISTS block_requests (
      hunt_id TEXT PRIMARY KEY,
      requested_at TEXT NOT NULL,
      slack_channel TEXT,
      slack_message TEXT,
      slack_ts TEXT,
      slack_error TEXT,
      targets_json TEXT,
      decision TEXT,
      decided_at TEXT,
      approver TEXT,
      executed_at TEXT,
      results_json TEXT
    );
  `);
}

export type ParsedRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: string;
};

export async function readRequest(): Promise<ParsedRequest> {
  const raw = await Bun.stdin.text();
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 4);
  const lines = head.split("\r\n");
  const [method = "GET", target = "/"] = (lines[0] ?? "").split(" ");
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const url = new URL(target, "http://internal");
  return { method: method.toUpperCase(), path: url.pathname, query: url.searchParams, headers, body };
}

export function respond(
  status: number,
  body: string,
  contentType = "application/json; charset=utf-8",
  extraHeaders: Record<string, string> = {},
): void {
  const statusText: Record<number, string> = {
    200: "OK",
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
  };
  const bytes = Buffer.byteLength(body);
  const extra = Object.entries(extraHeaders)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join("");
  process.stdout.write(
    `HTTP/1.1 ${status} ${statusText[status] ?? "OK"}\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `Content-Length: ${bytes}\r\n` +
      `Cache-Control: no-store\r\n` +
      extra +
      `\r\n` +
      body,
  );
}

export function respondHtml(status: number, body: string, extraHeaders: Record<string, string> = {}): void {
  respond(status, body, "text/html; charset=utf-8", extraHeaders);
}

/** Reads the headers off an upstream step's raw HTTP response stdout. */
export async function readUpstreamResponse(): Promise<{ headers: Record<string, string>; body: string }> {
  const raw = await Bun.stdin.text();
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 4);
  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n").slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body };
}

/** Linked steps receive the upstream step's raw stdout, which for a route step is a full HTTP response. */
export async function readUpstreamJson<T>(): Promise<T> {
  const raw = await Bun.stdin.text();
  let text = raw;
  if (/^HTTP\/1\.[01] /.test(raw)) {
    const match = /\r?\n\r?\n/.exec(raw);
    text = match ? raw.slice(match.index + match[0].length) : "";
  }
  return JSON.parse(text) as T;
}

export function classify(value: string): string | null {
  const v = value.trim();
  if (/^[0-9a-f]{40}$/i.test(v)) return "sha1";
  if (/^[0-9a-f]{64}$/i.test(v)) return "sha256";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every((o) => Number(o) <= 255)) return "ipv4";
  if (/^[0-9a-f:]{3,45}$/i.test(v) && v.includes("::")) return "ipv6";
  if (/^https?:\/\/\S+$/i.test(v)) return "url";
  if (/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i.test(v)) return "domain";
  return null;
}

/** Deterministic PRNG so forced demo modes produce identical results for identical inputs. */
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h |= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h |= 0;
    return (h >>> 0) / 4294967296;
  };
}

export function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length) % items.length]!;
}

export function intBetween(next: () => number, min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1));
}

/** All mock timestamps hang off the hunt's creation time so results are reproducible. */
export function offsetIso(baseIso: string, minutesBefore: number): string {
  const base = Date.parse(baseIso);
  return new Date(base - minutesBefore * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function decideStatus(
  mode: DemoMode,
  source: string,
  seed: string,
): "hit" | "no_match" | "error" {
  if (mode === "hits") return "hit";
  if (mode === "clean") return "no_match";
  if (mode === "error") return source === FORCED_ERROR_SOURCE ? "error" : "hit";
  const roll = Math.random();
  if (roll < 0.08) return "error";
  return rng(seed)() < 0.55 || Math.random() < 0.35 ? "hit" : "no_match";
}

export const ERROR_REASONS: Record<string, string> = {
  defender: "Advanced Hunting API returned 429 Too Many Requests after 3 retries (quota exhausted)",
  sentinel: "Log Analytics query timed out after 180s (workspace ingestion backlog)",
  proofpoint: "SIEM API returned 503 Service Unavailable (maintenance window)",
  zscaler: "NSS log feed unreachable: TLS handshake failed to nss.zscalertwo.net:443",
};
