import { openDb, nowIso } from "./db";
import { parseInput, respond } from "./http";
import { normalizeChaos, chaosSummary } from "./chaos";

interface StartPayload {
  alertId?: string;
  endpoint?: string;
  userEmail?: string;
  severity?: string;
  chaos?: unknown;
}

const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

const input = parseInput(await Bun.stdin.text());
const payload = (input.body ?? {}) as StartPayload;

const alertId = String(payload.alertId ?? "").trim();
const endpoint = String(payload.endpoint ?? "").trim();
const userEmail = String(payload.userEmail ?? "").trim();
const severity = String(payload.severity ?? "high").trim().toLowerCase();

const errors: string[] = [];
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(alertId)) errors.push("alertId must be 3-64 characters of letters, digits, dot, dash or underscore");
if (!/^[A-Za-z0-9][A-Za-z0-9.-]{1,127}$/.test(endpoint)) errors.push("endpoint must be a hostname of 2-128 characters");
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userEmail)) errors.push("userEmail must be an email address");
if (!SEVERITIES.has(severity)) errors.push("severity must be low, medium, high or critical");

if (errors.length > 0) {
  respond(400, { error: "invalid_request", details: errors });
  process.exit(0);
}

const chaos = normalizeChaos(payload.chaos);
const runId = `run-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8)}`;
const db = openDb();

db.query(
  `INSERT INTO runs (id, created_at, updated_at, alert_id, endpoint, user_email, severity, status, chaos, safe_to_retry, resume_count)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, 0, 0)`,
).run(runId, nowIso(), nowIso(), alertId, endpoint, userEmail, severity, JSON.stringify(chaos));

db.query(
  `INSERT INTO audit_log (run_id, ts, rel_ms, actor, stage, action, target, request_key, attempt, outcome, status_code, classification, latency_ms, detail)
   VALUES (?, ?, 0, 'Start Run', 'run', 'run.queue', ?, ?, NULL, 'queued', NULL, NULL, NULL, ?)`,
).run(runId, nowIso(), endpoint, runId, `queued containment for alert ${alertId}; chaos: ${chaosSummary(chaos).join("; ") || "none"}`);

db.query(
  `INSERT INTO attempt_log (run_id, ts, rel_ms, stage, attempt, event, level, outcome, status_code, classification, latency_ms, message, payload)
   VALUES (?, ?, 0, 'run', 0, 'run_queued', 'info', 'queued', NULL, NULL, NULL, ?, ?)`,
).run(
  runId,
  nowIso(),
  `run queued for ${endpoint}`,
  JSON.stringify({ run_id: runId, stage: "run", event: "run_queued", alert_id: alertId, endpoint, chaos: chaosSummary(chaos) }),
);

db.close();

respond(201, {
  runId,
  status: "running",
  alertId,
  endpoint,
  userEmail,
  severity,
  mode: "start",
  chaos: chaosSummary(chaos),
});
