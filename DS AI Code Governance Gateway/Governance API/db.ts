import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

export const VOLUME = "/storage/ds_governance";
export const DB_PATH = `${VOLUME}/governance.db`;

export type Submission = Record<string, any>;

export function openDb(readonly = false): Database {
  if (!readonly) mkdirSync(VOLUME, { recursive: true });
  const db = new Database(DB_PATH, readonly ? { readonly: true } : { create: true });
  if (!readonly) {
    db.run(`CREATE TABLE IF NOT EXISTS submissions (
      submission_id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL,
      developer_name TEXT, developer_email TEXT,
      team TEXT, region TEXT, source_tool TEXT, model_used TEXT,
      repo TEXT, branch TEXT, commit_sha TEXT, description TEXT, code_payload TEXT,
      risk_score INTEGER, scan_verdict TEXT,
      findings TEXT, model_policy TEXT, bypass TEXT, credentials TEXT,
      status TEXT, reviewer TEXT, reviewer_comment TEXT,
      decided_at TEXT, decision_seconds REAL, deployment_id TEXT, deployed_at TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL, submission_id TEXT, actor TEXT, action TEXT,
      policies_fired TEXT, comment TEXT, disposition TEXT, detail TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL, submission_id TEXT, severity TEXT, kind TEXT, message TEXT
    )`);
  }
  return db;
}

export function saveSubmission(db: Database, s: Submission) {
  const cols = [
    "submission_id", "received_at", "developer_name", "developer_email", "team", "region",
    "source_tool", "model_used", "repo", "branch", "commit_sha", "description", "code_payload",
    "risk_score", "scan_verdict", "findings", "model_policy", "bypass", "credentials",
    "status", "reviewer", "reviewer_comment", "decided_at", "decision_seconds",
    "deployment_id", "deployed_at",
  ];
  const values = cols.map((c) => {
    const v = s[c];
    if (v === undefined || v === null) return null;
    return typeof v === "object" ? JSON.stringify(v) : v;
  });
  db.run(
    `INSERT OR REPLACE INTO submissions (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    values,
  );
}

export function appendAudit(
  db: Database,
  e: {
    ts?: string; submission_id: string; actor: string; action: string;
    policies_fired?: string[]; comment?: string; disposition?: string; detail?: unknown;
  },
) {
  db.run(
    `INSERT INTO audit (ts, submission_id, actor, action, policies_fired, comment, disposition, detail)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      e.ts ?? new Date().toISOString(), e.submission_id, e.actor, e.action,
      JSON.stringify(e.policies_fired ?? []), e.comment ?? "", e.disposition ?? "",
      e.detail === undefined ? "{}" : JSON.stringify(e.detail),
    ],
  );
}

export function raiseSecurityEvent(
  db: Database,
  e: { ts?: string; submission_id: string; severity: string; kind: string; message: string },
) {
  db.run(
    `INSERT INTO security_events (ts, submission_id, severity, kind, message) VALUES (?,?,?,?,?)`,
    [e.ts ?? new Date().toISOString(), e.submission_id, e.severity, e.kind, e.message],
  );
}

export function logEvent(fields: Record<string, unknown>) {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`);
  console.error(parts.join(" "));
}

export async function readInput<T = any>(): Promise<T> {
  const raw = await Bun.stdin.text();
  if (!raw.trim()) throw new Error("no input received");
  return JSON.parse(raw) as T;
}
