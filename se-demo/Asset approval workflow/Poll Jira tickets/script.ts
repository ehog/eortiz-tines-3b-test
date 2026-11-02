import { openReadOnly } from "./db";

type Row = { issue_key: string; decision: string; approver: string };
const started = Date.now();
function log(level: string, event: string, msg: string, extra = {}) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level, step: "Poll Jira tickets", event, msg, ...extra }));
}

log("info", "poll_started", "Reading pending decisions from mock state.");
let db: ReturnType<typeof openReadOnly> = null;
try {
  db = openReadOnly();
  let rows: Row[] = [];
  if (!db) {
    log("warn", "state_missing", "No mock database exists; nothing to reconcile.");
  } else {
    db.exec("PRAGMA busy_timeout = 5000");
    log("info", "database_opened", "Opened the read-only mock database.");
    rows = db.query<Row, []>(`
      WITH pending AS (
        SELECT i.key, i.status, i.updated_at
        FROM issues i
        WHERE i.status IN ('Allow', 'Deny')
          AND EXISTS (SELECT 1 FROM assets a WHERE a.issue_key = i.key AND a.status = 'pending_review')
        ORDER BY i.updated_at, i.key
        LIMIT 100
      ), latest AS (
        SELECT c.issue_key, MAX(c.id) AS id
        FROM issue_changelog c
        JOIN pending p ON p.key = c.issue_key
        WHERE c.field = 'status'
        GROUP BY c.issue_key
      )
      SELECT p.key AS issue_key, p.status AS decision,
        COALESCE(c.author, 'unknown@example.com') AS approver
      FROM pending p
      LEFT JOIN latest l ON l.issue_key = p.key
      LEFT JOIN issue_changelog c ON c.id = l.id
      ORDER BY p.updated_at, p.key
    `).all();
  }
  db?.close();
  db = null;
  if (rows.length > 0) {
    console.log(JSON.stringify({ decisions: rows.map(row => ({ ...row, source: "jira_poll" })) }));
  }
  log("info", "poll_completed", "Finished polling pending decisions.", { count: rows.length, duration_ms: Date.now() - started });
} catch (error) {
  log("error", "poll_failed", "Failed to read pending decisions.", { error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - started });
  throw error;
} finally {
  db?.close();
}
