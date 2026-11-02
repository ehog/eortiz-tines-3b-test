import { Database } from "bun:sqlite";

export const DB_PATH = "/storage/patching/state.db";

export function findingId(deviceId: string | number, packageId: string | number) {
  return `${deviceId}|${packageId}`;
}

export function openState(): Database {
  const db = new Database(DB_PATH, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      package_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      severity TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      package_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      severity TEXT NOT NULL,
      decision TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS decisions_decided_at ON decisions (decided_at);
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at TEXT NOT NULL,
      devices INTEGER NOT NULL,
      matches INTEGER NOT NULL
    );
  `);
  return db;
}

export type DecisionRecord = {
  decision: "YES" | "NO";
  device_id: string;
  device_name: string;
  package_id: string;
  package_name: string;
  severity: string;
  decided_by: string;
  decided_at: string;
};

export function recordDecision(record: DecisionRecord, source: "slack" | "app") {
  const db = openState();
  const id = findingId(record.device_id, record.package_id);
  db.transaction(() => {
    db.prepare(`
      INSERT INTO decisions
        (finding_id, device_id, device_name, package_id, package_name, severity, decision, decided_by, decided_at, source)
      VALUES ($finding_id, $device_id, $device_name, $package_id, $package_name, $severity, $decision, $decided_by, $decided_at, $source)
    `).run({
      $finding_id: id,
      $device_id: record.device_id,
      $device_name: record.device_name,
      $package_id: record.package_id,
      $package_name: record.package_name,
      $severity: record.severity,
      $decision: record.decision,
      $decided_by: record.decided_by,
      $decided_at: record.decided_at,
      $source: source,
    });
    db.prepare("UPDATE findings SET status = $status WHERE id = $id").run({
      $status: record.decision === "YES" ? "patching" : "postponed",
      $id: id,
    });
  })();
  db.close();
}
