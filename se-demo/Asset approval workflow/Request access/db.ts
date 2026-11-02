import { Database } from "bun:sqlite";

export const DB_PATH = "/storage/mock_state/mock.db";

export type Asset = {
  id: string;
  name: string;
  category: string;
  vendor: string;
  risk_score: number;
  discovered_by: string;
  first_seen_user: string;
  status: string;
  issue_key: string | null;
  justification: string | null;
  approver: string | null;
  created_at: string;
  updated_at: string;
};

export type Issue = {
  key: string;
  asset_id: string;
  summary: string;
  description: string;
  reporter: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export const ASSET_CATEGORIES = [
  "genai_app",
  "browser_extension",
  "mcp_server",
  "ai_agent",
  "model",
  "ai_saas",
];

export const ASSET_STATUSES = ["blocked", "pending_review", "allowed", "denied"];

export const ISSUE_STATUSES = ["Open", "In Review", "Allow", "Deny"];

export function now(): string {
  return new Date().toISOString();
}

export function openWritable(): Database {
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = TRUNCATE");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

export function openReadOnly(): Database | null {
  if (!Bun.file(DB_PATH).size) return null;
  return new Database(DB_PATH, { readonly: true });
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      vendor TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      discovered_by TEXT NOT NULL,
      first_seen_user TEXT NOT NULL,
      status TEXT NOT NULL,
      issue_key TEXT,
      justification TEXT,
      approver TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS issues (
      key TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT NOT NULL,
      reporter TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS issue_changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT NOT NULL,
      field TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT NOT NULL,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

export function audit(
  db: Database,
  actor: string,
  action: string,
  subject: string,
  detail?: unknown,
) {
  db.query(
    "INSERT INTO audit (at, actor, action, subject, detail) VALUES (?, ?, ?, ?, ?)",
  ).run(
    now(),
    actor,
    action,
    subject,
    detail === undefined ? null : JSON.stringify(detail),
  );
}

export function emit(db: Database, kind: string, payload: unknown) {
  db.query(
    "INSERT INTO events (kind, payload, created_at) VALUES (?, ?, ?)",
  ).run(kind, JSON.stringify(payload), now());
}

export function drainEvents(db: Database, kind: string) {
  const rows = db
    .query<{ id: number; payload: string }, [string]>(
      "SELECT id, payload FROM events WHERE kind = ? AND processed = 0 ORDER BY id",
    )
    .all(kind);
  for (const row of rows) {
    db.query("UPDATE events SET processed = 1 WHERE id = ?").run(row.id);
  }
  return rows.map((row) => JSON.parse(row.payload));
}

const SEED: Array<Omit<Asset, "issue_key" | "justification" | "approver" | "created_at" | "updated_at">> = [
  {
    id: "AST-1001",
    name: "ChatGPT",
    category: "genai_app",
    vendor: "OpenAI",
    risk_score: 62,
    discovered_by: "browser_agent",
    first_seen_user: "dana.lopez@example.com",
    status: "allowed",
  },
  {
    id: "AST-1002",
    name: "DeepSeek Chat",
    category: "genai_app",
    vendor: "DeepSeek",
    risk_score: 91,
    discovered_by: "network",
    first_seen_user: "sam.patel@example.com",
    status: "blocked",
  },
  {
    id: "AST-1003",
    name: "Cursor",
    category: "ai_saas",
    vendor: "Anysphere",
    risk_score: 44,
    discovered_by: "saas_scan",
    first_seen_user: "kim.tran@example.com",
    status: "blocked",
  },
  {
    id: "AST-1004",
    name: "Monica AI Assistant",
    category: "browser_extension",
    vendor: "Monica",
    risk_score: 78,
    discovered_by: "browser_agent",
    first_seen_user: "alex.ng@example.com",
    status: "blocked",
  },
  {
    id: "AST-1005",
    name: "filesystem-mcp",
    category: "mcp_server",
    vendor: "community",
    risk_score: 84,
    discovered_by: "network",
    first_seen_user: "jo.rivera@example.com",
    status: "blocked",
  },
  {
    id: "AST-1006",
    name: "llama-3.1-70b (self-hosted)",
    category: "model",
    vendor: "Meta",
    risk_score: 51,
    discovered_by: "network",
    first_seen_user: "ml-platform@example.com",
    status: "blocked",
  },
];

export function seed(db: Database) {
  const count = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM assets")
    .get()!.n;
  if (count > 0) return;
  const at = now();
  for (const asset of SEED) {
    db.query(
      `INSERT INTO assets (id, name, category, vendor, risk_score, discovered_by, first_seen_user, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      asset.id,
      asset.name,
      asset.category,
      asset.vendor,
      asset.risk_score,
      asset.discovered_by,
      asset.first_seen_user,
      asset.status,
      at,
      at,
    );
  }
  audit(db, "onyx", "seed", "assets", { count: SEED.length });
}

export function nextAssetId(db: Database): string {
  const row = db
    .query<{ id: string | null }, []>(
      "SELECT MAX(id) AS id FROM assets WHERE id LIKE 'AST-%'",
    )
    .get();
  const n = row?.id ? Number(row.id.slice(4)) : 1000;
  return `AST-${(Number.isNaN(n) ? 1000 : n) + 1}`;
}

export function nextIssueKey(db: Database): string {
  const row = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM issues")
    .get()!;
  return `AIGOV-${row.n + 1}`;
}
