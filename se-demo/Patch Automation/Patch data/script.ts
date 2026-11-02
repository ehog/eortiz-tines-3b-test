import { Database } from "bun:sqlite";
import { DB_PATH } from "./state";

type Finding = {
  id: string;
  device_id: string;
  device_name: string;
  package_id: string;
  package_name: string;
  severity: string;
  first_seen: string;
  last_seen: string;
  status: string;
};

type Decision = {
  id: number;
  finding_id: string;
  device_id: string;
  device_name: string;
  package_id: string;
  package_name: string;
  severity: string;
  decision: string;
  decided_by: string;
  decided_at: string;
  source: string;
};

let findings: Finding[] = [];
let decisions: Decision[] = [];
let lastRun: { ran_at: string; devices: number; matches: number } | null = null;

if (await Bun.file(DB_PATH).exists()) {
  const db = new Database(DB_PATH, { readonly: true });
  findings = db
    .query<Finding, []>(
      `SELECT id, device_id, device_name, package_id, package_name, severity, first_seen, last_seen, status
       FROM findings ORDER BY device_name, package_name`,
    )
    .all();
  decisions = db
    .query<Decision, []>(
      `SELECT id, finding_id, device_id, device_name, package_id, package_name, severity, decision, decided_by, decided_at, source
       FROM decisions ORDER BY decided_at DESC LIMIT 200`,
    )
    .all();
  lastRun =
    db
      .query<{ ran_at: string; devices: number; matches: number }, []>(
        "SELECT ran_at, devices, matches FROM runs ORDER BY id DESC LIMIT 1",
      )
      .get() ?? null;
  db.close();
}

const bySeverity: Record<string, number> = {};
for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

const byStatus: Record<string, number> = { open: 0, patching: 0, postponed: 0 };
for (const f of findings) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;

const byDay: Record<string, { patched: number; postponed: number }> = {};
for (const d of decisions) {
  const day = d.decided_at.slice(0, 10);
  const bucket = (byDay[day] ??= { patched: 0, postponed: 0 });
  if (d.decision === "YES") bucket.patched += 1;
  else bucket.postponed += 1;
}

const payload = {
  generated_at: new Date().toISOString(),
  last_run: lastRun,
  totals: {
    findings: findings.length,
    devices: new Set(findings.map((f) => f.device_id)).size,
    patched: decisions.filter((d) => d.decision === "YES").length,
    postponed: decisions.filter((d) => d.decision === "NO").length,
  },
  by_severity: bySeverity,
  by_status: byStatus,
  by_day: Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({ day, ...counts })),
  findings,
  decisions,
};

const body = Buffer.from(JSON.stringify(payload));
process.stdout.write(
  `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ${body.length}\r\n\r\n`,
);
process.stdout.write(body);
