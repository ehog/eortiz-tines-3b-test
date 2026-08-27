import { openDbReadonly, STAGE_KEYS, type RunRow } from "./db";
import { parseInput, respond } from "./http";

interface StageRow {
  stage: string;
  position: number;
  status: string;
  attempts: number;
  started_rel_ms: number | null;
  duration_ms: number | null;
  timeout_ms: number | null;
  max_retries: number | null;
  status_code: number | null;
  classification: string | null;
  request_key: string | null;
  detail: string | null;
  updated_at: string;
}

interface AttemptRow {
  id: number;
  ts: string;
  rel_ms: number;
  stage: string;
  attempt: number;
  event: string;
  level: string;
  outcome: string;
  status_code: number | null;
  classification: string | null;
  latency_ms: number | null;
  message: string;
  payload: string;
}

interface AuditRow {
  id: number;
  ts: string;
  rel_ms: number;
  actor: string;
  stage: string;
  action: string;
  target: string;
  request_key: string | null;
  attempt: number | null;
  outcome: string;
  status_code: number | null;
  classification: string | null;
  latency_ms: number | null;
  detail: string;
}

function summarizeRun(run: RunRow) {
  return {
    runId: run.id,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    alertId: run.alert_id,
    endpoint: run.endpoint,
    userEmail: run.user_email,
    severity: run.severity,
    status: run.status,
    chaos: safeParse(run.chaos),
    ticketNumber: run.ticket_number,
    ticketSysId: run.ticket_sys_id,
    ticketState: run.ticket_state,
    isolationState: run.isolation_state,
    failedStage: run.failed_stage,
    failureReason: run.failure_reason,
    failureClass: run.failure_class,
    guardrail: run.guardrail,
    safeToRetry: run.safe_to_retry === 1,
    resumeCount: run.resume_count,
  };
}

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const input = parseInput(await Bun.stdin.text());
const runId = (input.query.runId ?? "").trim();
const limit = Math.min(50, Math.max(1, Number(input.query.limit ?? 20) || 20));

const db = openDbReadonly();
if (!db) {
  respond(200, { runs: [], run: null, stages: [], attempts: [], audit: [], stageOrder: STAGE_KEYS, empty: true });
  process.exit(0);
}

const runs = db
  .query<RunRow, [number]>("SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT ?")
  .all(limit)
  .map(summarizeRun);

if (!runId) {
  db.close();
  respond(200, { runs, run: null, stages: [], attempts: [], audit: [], stageOrder: STAGE_KEYS });
  process.exit(0);
}

const run = db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(runId);
if (!run) {
  db.close();
  respond(404, { error: "not_found", details: [`run ${runId} does not exist`], runs });
  process.exit(0);
}

const stages = db
  .query<StageRow, [string]>("SELECT * FROM run_stages WHERE run_id = ? ORDER BY position")
  .all(runId)
  .map((row) => ({
    stage: row.stage,
    position: row.position,
    status: row.status,
    attempts: row.attempts,
    startedRelMs: row.started_rel_ms,
    durationMs: row.duration_ms,
    timeoutMs: row.timeout_ms,
    maxRetries: row.max_retries,
    statusCode: row.status_code,
    classification: row.classification,
    requestKey: row.request_key,
    detail: row.detail,
    updatedAt: row.updated_at,
  }));

const attempts = db
  .query<AttemptRow, [string]>("SELECT * FROM attempt_log WHERE run_id = ? ORDER BY id")
  .all(runId)
  .map((row) => ({
    id: row.id,
    ts: row.ts,
    relMs: row.rel_ms,
    stage: row.stage,
    attempt: row.attempt,
    event: row.event,
    level: row.level,
    outcome: row.outcome,
    statusCode: row.status_code,
    classification: row.classification,
    latencyMs: row.latency_ms,
    message: row.message,
    payload: safeParse(row.payload),
  }));

const audit = db
  .query<AuditRow, [string]>("SELECT * FROM audit_log WHERE run_id = ? ORDER BY id")
  .all(runId)
  .map((row) => ({
    id: row.id,
    ts: row.ts,
    relMs: row.rel_ms,
    actor: row.actor,
    stage: row.stage,
    action: row.action,
    target: row.target,
    requestKey: row.request_key,
    attempt: row.attempt,
    outcome: row.outcome,
    statusCode: row.status_code,
    classification: row.classification,
    latencyMs: row.latency_ms,
    detail: row.detail,
  }));

const completedAll = stages.filter((stage) => stage.status === "succeeded").map((stage) => stage.stage);
const completed = STAGE_KEYS.filter((stage) => completedAll.includes(stage));
const resumeFrom = STAGE_KEYS.find((stage) => !completedAll.includes(stage)) ?? null;

db.close();

respond(200, {
  runs,
  run: summarizeRun(run),
  stages,
  attempts,
  audit,
  stageOrder: STAGE_KEYS,
  resume: { resumeFrom, willSkip: completed, allowed: run.status !== "running" && run.status !== "contained" },
});
