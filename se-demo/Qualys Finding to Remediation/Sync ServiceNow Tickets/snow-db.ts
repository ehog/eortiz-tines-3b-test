// Data layer for the mocked ServiceNow change table (volume `servicenow_store`).
// Records are shaped like ServiceNow change requests, so swapping the mock for a
// real instance means replacing these calls with Table API requests.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";

export const DB_DIR = "/storage/servicenow_store";
export const DB_PATH = `${DB_DIR}/snow.db`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  sys_id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  short_description TEXT NOT NULL,
  description TEXT NOT NULL,
  assignment_group TEXT NOT NULL,
  team TEXT NOT NULL,
  application TEXT NOT NULL,
  priority INTEGER NOT NULL,
  risk_score INTEGER NOT NULL,
  risk_band TEXT NOT NULL,
  state TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  due_date TEXT NOT NULL,
  closed_at TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  chased_at TEXT,
  finding_count INTEGER NOT NULL,
  finding_ids TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sys_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  author TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_notes_ticket ON work_notes (sys_id, id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export const OPEN_STATES = ["new", "assess", "implement"] as const;
export type TicketState = (typeof OPEN_STATES)[number] | "closed";

export type TicketRow = {
  sys_id: string;
  number: string;
  short_description: string;
  description: string;
  assignment_group: string;
  team: string;
  application: string;
  priority: number;
  risk_score: number;
  risk_band: string;
  state: string;
  opened_at: string;
  updated_at: string;
  due_date: string;
  closed_at: string | null;
  escalation_level: number;
  chased_at: string | null;
  finding_count: number;
  finding_ids: string;
  payload: string;
};

export type WorkNote = { id: number; sys_id: string; created_at: string; author: string; note: string };

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

export function nextNumber(db: Database): string {
  const row = db.query("SELECT value FROM meta WHERE key = 'last_number'").get() as
    | { value: string }
    | null;
  const next = (row ? Number(row.value) : 31200) + 1;
  db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_number', $v)").run({
    $v: String(next),
  });
  return `CHG00${next}`;
}

export function priorityFor(band: string): number {
  if (band === "critical") return 1;
  if (band === "high") return 2;
  if (band === "medium") return 3;
  return 4;
}

export function listTickets(
  db: Database | null,
  filters: { state?: "open" | "closed" | "all"; team?: string; sysId?: string } = {},
): TicketRow[] {
  if (!db) return [];
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filters.state === "open") where.push("state != 'closed'");
  if (filters.state === "closed") where.push("state = 'closed'");
  if (filters.team) {
    where.push("team = $team");
    params.$team = filters.team;
  }
  if (filters.sysId) {
    where.push("sys_id = $sys_id");
    params.$sys_id = filters.sysId;
  }
  let sql = "SELECT * FROM tickets";
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY priority ASC, due_date ASC";
  return db.query(sql).all(params) as TicketRow[];
}

export function findOpenTicket(db: Database, team: string, application: string): TicketRow | null {
  return (
    (db
      .query(
        "SELECT * FROM tickets WHERE team = $team AND application = $app AND state != 'closed' ORDER BY opened_at DESC LIMIT 1",
      )
      .get({ $team: team, $app: application }) as TicketRow | null) ?? null
  );
}

export function workNotes(db: Database | null, sysId: string): WorkNote[] {
  if (!db) return [];
  return db
    .query("SELECT * FROM work_notes WHERE sys_id = $s ORDER BY id ASC")
    .all({ $s: sysId }) as WorkNote[];
}

export function addWorkNote(
  db: Database,
  sysId: string,
  note: string,
  author = "vuln-automation",
  createdAt = new Date().toISOString(),
): void {
  db.query(
    "INSERT INTO work_notes (sys_id, created_at, author, note) VALUES ($s, $c, $a, $n)",
  ).run({ $s: sysId, $c: createdAt, $a: author, $n: note });
}

export type NewTicket = {
  short_description: string;
  description: string;
  assignment_group: string;
  team: string;
  application: string;
  priority: number;
  risk_score: number;
  risk_band: string;
  state?: TicketState;
  opened_at?: string;
  due_date: string;
  closed_at?: string | null;
  finding_ids: string[];
  payload: unknown;
};

/**
 * ServiceNow mints sys_ids server-side; the mock derives one from the record's
 * identity so the same change produced twice keeps the same id, which also makes
 * the store reproducible in tests.
 */
function sysIdFor(parts: string[]): string {
  const seed = parts.join("|");
  const a = Bun.hash.xxHash64(seed).toString(16).padStart(16, "0");
  const b = Bun.hash.xxHash64(`${seed}#2`).toString(16).padStart(16, "0");
  return `${a}${b}`.slice(0, 32);
}

export function createTicket(db: Database, ticket: NewTicket): TicketRow {
  const number = nextNumber(db);
  const openedAt = ticket.opened_at ?? new Date().toISOString();
  const sysId = sysIdFor([number, ticket.team, ticket.application, openedAt]);
  db.query(
    `INSERT INTO tickets (
      sys_id, number, short_description, description, assignment_group, team, application,
      priority, risk_score, risk_band, state, opened_at, updated_at, due_date, closed_at,
      escalation_level, chased_at, finding_count, finding_ids, payload
    ) VALUES (
      $sys_id, $number, $short_description, $description, $assignment_group, $team, $application,
      $priority, $risk_score, $risk_band, $state, $opened_at, $updated_at, $due_date, $closed_at,
      0, NULL, $finding_count, $finding_ids, $payload
    )`,
  ).run({
    $sys_id: sysId,
    $number: number,
    $short_description: ticket.short_description,
    $description: ticket.description,
    $assignment_group: ticket.assignment_group,
    $team: ticket.team,
    $application: ticket.application,
    $priority: ticket.priority,
    $risk_score: ticket.risk_score,
    $risk_band: ticket.risk_band,
    $state: ticket.state ?? "new",
    $opened_at: openedAt,
    $updated_at: openedAt,
    $due_date: ticket.due_date,
    $closed_at: ticket.closed_at ?? null,
    $finding_count: ticket.finding_ids.length,
    $finding_ids: JSON.stringify(ticket.finding_ids),
    $payload: JSON.stringify(ticket.payload),
  });
  return db.query("SELECT * FROM tickets WHERE sys_id = $s").get({ $s: sysId }) as TicketRow;
}

const UPDATABLE = new Set([
  "short_description",
  "description",
  "priority",
  "risk_score",
  "risk_band",
  "state",
  "due_date",
  "closed_at",
  "escalation_level",
  "chased_at",
  "finding_count",
  "finding_ids",
  "payload",
]);

export function updateTicket(
  db: Database,
  sysId: string,
  patch: Record<string, string | number | null>,
  updatedAt = new Date().toISOString(),
): TicketRow | null {
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { $sys_id: sysId, $updated_at: updatedAt };
  for (const [field, value] of Object.entries(patch)) {
    if (!UPDATABLE.has(field)) continue;
    sets.push(`${field} = $${field}`);
    params[`$${field}`] = value;
  }
  if (!sets.length) return null;
  sets.push("updated_at = $updated_at");
  db.query(`UPDATE tickets SET ${sets.join(", ")} WHERE sys_id = $sys_id`).run(params);
  return (db.query("SELECT * FROM tickets WHERE sys_id = $s").get({ $s: sysId }) as TicketRow) ?? null;
}

export type TicketRecord = {
  sys_id: string;
  number: string;
  short_description: string;
  description: string;
  assignment_group: string;
  team: string;
  application: string;
  priority: number;
  risk_score: number;
  risk_band: string;
  state: string;
  opened_at: string;
  updated_at: string;
  due_date: string;
  closed_at: string | null;
  escalation_level: number;
  chased_at: string | null;
  finding_count: number;
  finding_ids: string[];
  days_to_due: number | null;
  overdue: boolean;
  findings: unknown;
  work_notes: { created_at: string; author: string; note: string }[];
};

export function toRecord(db: Database | null, row: TicketRow, now: Date): TicketRecord {
  const due = new Date(row.due_date).getTime();
  const reference = row.closed_at ? new Date(row.closed_at).getTime() : now.getTime();
  const daysToDue = Math.round(((due - reference) / 86_400_000) * 10) / 10;
  return {
    sys_id: row.sys_id,
    number: row.number,
    short_description: row.short_description,
    description: row.description,
    assignment_group: row.assignment_group,
    team: row.team,
    application: row.application,
    priority: row.priority,
    risk_score: row.risk_score,
    risk_band: row.risk_band,
    state: row.state,
    opened_at: row.opened_at,
    updated_at: row.updated_at,
    due_date: row.due_date,
    closed_at: row.closed_at,
    escalation_level: row.escalation_level,
    chased_at: row.chased_at,
    finding_count: row.finding_count,
    finding_ids: JSON.parse(row.finding_ids),
    days_to_due: Number.isFinite(daysToDue) ? daysToDue : null,
    overdue: row.state !== "closed" && due < now.getTime(),
    findings: JSON.parse(row.payload),
    work_notes: workNotes(db, row.sys_id).map((n) => ({
      created_at: n.created_at,
      author: n.author,
      note: n.note,
    })),
  };
}
