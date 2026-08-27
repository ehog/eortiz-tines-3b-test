import { openDb, nowIso, STAGE_KEYS, type RunRow } from "./db";
import { parseInput, respond } from "./http";
import { normalizeChaos, chaosSummary, CHAOS_KEYS } from "./chaos";

interface RetryPayload {
  runId?: string;
  chaos?: unknown;
  clearChaos?: boolean;
}

const input = parseInput(await Bun.stdin.text());
const payload = (input.body ?? {}) as RetryPayload;
const runId = String(payload.runId ?? input.query.runId ?? "").trim();

if (!runId) {
  respond(400, { error: "invalid_request", details: ["runId is required"] });
  process.exit(0);
}

const db = openDb();
const run = db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(runId);

if (!run) {
  db.close();
  respond(404, { error: "not_found", details: [`run ${runId} does not exist`] });
  process.exit(0);
}

if (run.status === "contained") {
  db.close();
  respond(409, {
    error: "nothing_to_resume",
    details: [`run ${runId} is already contained — resuming would repeat no work`],
  });
  process.exit(0);
}

const completedAll = db
  .query<{ stage: string }, [string]>("SELECT stage FROM run_stages WHERE run_id = ? AND status = 'succeeded'")
  .all(runId)
  .map((row) => row.stage);
const completed = STAGE_KEYS.filter((stage) => completedAll.includes(stage));
const resumeFrom = STAGE_KEYS.find((stage) => !completedAll.includes(stage)) ?? null;

if (!resumeFrom) {
  db.close();
  respond(409, { error: "nothing_to_resume", details: [`run ${runId} has no incomplete stages`] });
  process.exit(0);
}

const overrideChaos = payload.clearChaos === true || payload.chaos !== undefined;
const chaos = payload.clearChaos === true ? normalizeChaos({}) : normalizeChaos(payload.chaos ?? JSON.parse(run.chaos || "{}"));

if (overrideChaos) {
  db.query("UPDATE runs SET chaos = ? WHERE id = ?").run(JSON.stringify(chaos), runId);
  // New chaos settings need fresh failure counters, otherwise "fail N then succeed" stays exhausted.
  for (const key of CHAOS_KEYS) db.query("DELETE FROM mock_state WHERE key = ?").run(`chaos_attempts:${runId}:${key}`);
}

const resumeCount = run.resume_count + 1;
db.query("UPDATE runs SET status = 'running', resume_count = ?, updated_at = ?, finished_at = NULL WHERE id = ?").run(
  resumeCount,
  nowIso(),
  runId,
);

const detail = `resume #${resumeCount} from ${resumeFrom}; skipping ${completed.length ? completed.join(", ") : "nothing"}; chaos: ${
  chaosSummary(chaos).join("; ") || "none"
}`;

db.query(
  `INSERT INTO audit_log (run_id, ts, rel_ms, actor, stage, action, target, request_key, attempt, outcome, status_code, classification, latency_ms, detail)
   VALUES (?, ?, (SELECT COALESCE(MAX(rel_ms), 0) + 1 FROM audit_log WHERE run_id = ?), 'Retry Run', 'run', 'run.resume_requested', ?, ?, NULL, 'queued', NULL, NULL, NULL, ?)`,
).run(runId, nowIso(), runId, run.endpoint, runId, detail);

db.close();

respond(202, {
  runId,
  status: "running",
  mode: "resume",
  resumeFrom,
  skipping: completed,
  resumeCount,
  chaos: chaosSummary(chaos),
});
