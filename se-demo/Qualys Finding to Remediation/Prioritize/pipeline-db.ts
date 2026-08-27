// Shared state for the pipeline itself (volume `pipeline_state`): scoring
// weights, the demo clock offset, seen-detection fingerprints, per-stage run
// records, and the latest remediation report.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";

export const DB_DIR = "/storage/pipeline_state";
export const DB_PATH = `${DB_DIR}/pipeline.db`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seen (
  fingerprint TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stage_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS stage_runs_run ON stage_runs (run_id);
CREATE INDEX IF NOT EXISTS stage_runs_stage ON stage_runs (stage, id DESC);
`;

export function openWrite(): Database {
  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  // Rollback journalling, not WAL: readonly mounts cannot create the WAL shared-memory file.
  db.exec("PRAGMA journal_mode = DELETE");
  db.run(SCHEMA);
  return db;
}

export function openRead(): Database | null {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

export function getConfig(db: Database | null, key: string): string | null {
  if (!db) return null;
  try {
    const row = db.query("SELECT value FROM config WHERE key = $k").get({ $k: key }) as
      | { value: string }
      | null;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setConfig(db: Database, key: string, value: string): void {
  db.query("INSERT OR REPLACE INTO config (key, value) VALUES ($k, $v)").run({
    $k: key,
    $v: value,
  });
}

/** Days the demo clock has been fast-forwarded, used to breach SLAs on demand. */
export function clockOffsetDays(db: Database | null): number {
  const raw = getConfig(db, "clock_offset_days");
  const parsed = raw === null ? 0 : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The instant a stage should treat as "now": the run's reference timestamp when
 * one is supplied, shifted by the demo clock. Threading one reference through a
 * run keeps every SLA date and work note in it consistent, and makes stage
 * output reproducible.
 */
export function referenceNow(db: Database | null, reference?: string | null): Date {
  const parsed = reference ? new Date(reference).getTime() : Number.NaN;
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + clockOffsetDays(db) * 86_400_000);
}

export function demoNow(db: Database | null): Date {
  return referenceNow(db, null);
}

export type StageRecord = {
  run_id: string;
  stage: string;
  trigger: string;
  status: "success" | "skipped" | "error";
  started_at: string;
  duration_ms: number;
  record_count: number;
  summary: string;
  payload: unknown;
  error?: string | null;
};

export function recordStage(db: Database, record: StageRecord): void {
  db.query(
    `INSERT INTO stage_runs
      (run_id, stage, trigger, status, started_at, finished_at, duration_ms, record_count, summary, payload, error)
     VALUES ($run_id, $stage, $trigger, $status, $started_at, $finished_at, $duration_ms, $record_count, $summary, $payload, $error)`,
  ).run({
    $run_id: record.run_id,
    $stage: record.stage,
    $trigger: record.trigger,
    $status: record.status,
    $started_at: record.started_at,
    $finished_at: new Date().toISOString(),
    $duration_ms: record.duration_ms,
    $record_count: record.record_count,
    $summary: record.summary,
    $payload: JSON.stringify(record.payload),
    $error: record.error ?? null,
  });
}

export type StageRow = {
  id: number;
  run_id: string;
  stage: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  record_count: number;
  summary: string;
  payload: string;
  error: string | null;
};

/** Latest recorded payload for a stage — the input a single-stage rerun replays. */
export function latestPayload<T>(db: Database | null, stage: string): T | null {
  if (!db) return null;
  const row = db
    .query(
      "SELECT payload FROM stage_runs WHERE stage = $s AND status = 'success' ORDER BY id DESC LIMIT 1",
    )
    .get({ $s: stage }) as { payload: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export function latestStageRows(db: Database | null, limit = 40): StageRow[] {
  if (!db) return [];
  return db
    .query("SELECT * FROM stage_runs ORDER BY id DESC LIMIT $limit")
    .all({ $limit: limit }) as StageRow[];
}

export function seenFingerprints(db: Database | null): Set<string> {
  if (!db) return new Set();
  const rows = db.query("SELECT fingerprint FROM seen").all() as { fingerprint: string }[];
  return new Set(rows.map((r) => r.fingerprint));
}

export function markSeen(db: Database, fingerprint: string, findingId: string): void {
  db.query(
    "INSERT OR REPLACE INTO seen (fingerprint, finding_id, seen_at) VALUES ($f, $i, $t)",
  ).run({ $f: fingerprint, $i: findingId, $t: new Date().toISOString() });
}

export function clearSeen(db: Database): void {
  db.run("DELETE FROM seen");
}

export function newRunId(): string {
  return `run-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}
