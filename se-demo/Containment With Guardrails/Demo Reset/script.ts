import { openDb, nowIso } from "./db";
import { parseInput, respond } from "./http";

interface ResetPayload {
  scope?: string;
}

const input = parseInput(await Bun.stdin.text());
const payload = (input.body ?? {}) as ResetPayload;
const scope = payload.scope === "mocks" ? "mocks" : "all";

const db = openDb();
const before = {
  runs: db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM runs").get()?.c ?? 0,
  attempts: db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM attempt_log").get()?.c ?? 0,
  audit: db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM audit_log").get()?.c ?? 0,
  mockKeys: db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM mock_state").get()?.c ?? 0,
};

db.exec("BEGIN");
db.exec("DELETE FROM mock_state");
if (scope === "all") {
  db.exec("DELETE FROM run_stages");
  db.exec("DELETE FROM attempt_log");
  db.exec("DELETE FROM audit_log");
  db.exec("DELETE FROM runs");
}
db.exec("COMMIT");
db.close();

respond(200, {
  ok: true,
  scope,
  clearedAt: nowIso(),
  cleared: scope === "all" ? before : { mockKeys: before.mockKeys },
  message:
    scope === "all"
      ? "Run history, audit trail and simulated ServiceNow/Defender state cleared."
      : "Simulated ServiceNow tickets, isolation state and chaos counters cleared; run history kept.",
});
