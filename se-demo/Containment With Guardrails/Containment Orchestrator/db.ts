import { Database } from "bun:sqlite";

export const VOLUME = "/storage/containment_state";
export const DB_PATH = `${VOLUME}/containment.sqlite`;

export const STAGE_KEYS = [
  "proofpoint_enrich",
  "zscaler_enrich",
  "defender_query",
  "servicenow_create",
  "endpoint_isolate",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export interface RunRow {
  id: string;
  created_at: string;
  updated_at: string;
  alert_id: string;
  endpoint: string;
  user_email: string;
  severity: string;
  status: string;
  chaos: string;
  ticket_number: string | null;
  ticket_sys_id: string | null;
  ticket_state: string | null;
  isolation_state: string | null;
  failed_stage: string | null;
  failure_reason: string | null;
  failure_class: string | null;
  guardrail: string | null;
  safe_to_retry: number;
  resume_count: number;
  started_at: string | null;
  finished_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  user_email TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  chaos TEXT NOT NULL,
  ticket_number TEXT,
  ticket_sys_id TEXT,
  ticket_state TEXT,
  isolation_state TEXT,
  failed_stage TEXT,
  failure_reason TEXT,
  failure_class TEXT,
  guardrail TEXT,
  safe_to_retry INTEGER NOT NULL DEFAULT 0,
  resume_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS run_stages (
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_rel_ms INTEGER,
  duration_ms INTEGER,
  timeout_ms INTEGER,
  max_retries INTEGER,
  status_code INTEGER,
  classification TEXT,
  request_key TEXT,
  detail TEXT,
  result TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, stage)
);
CREATE TABLE IF NOT EXISTS attempt_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  rel_ms INTEGER NOT NULL,
  stage TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  event TEXT NOT NULL,
  level TEXT NOT NULL,
  outcome TEXT NOT NULL,
  status_code INTEGER,
  classification TEXT,
  latency_ms INTEGER,
  message TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempt_log_run ON attempt_log (run_id, id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  rel_ms INTEGER NOT NULL,
  actor TEXT NOT NULL,
  stage TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  request_key TEXT,
  attempt INTEGER,
  outcome TEXT NOT NULL,
  status_code INTEGER,
  classification TEXT,
  latency_ms INTEGER,
  detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_run ON audit_log (run_id, id);
CREATE TABLE IF NOT EXISTS mock_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(): Database {
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

export function openDbReadonly(): Database | null {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    db.query("SELECT 1 FROM runs LIMIT 1").all();
    return db;
  } catch {
    return null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
