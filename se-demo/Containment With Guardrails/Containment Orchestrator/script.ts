import { openDb, nowIso, STAGE_KEYS, type RunRow, type StageKey } from "./db";
import { parseInput, branchPrefix } from "./http";
import { normalizeChaos, chaosSummary, type ChaosConfig } from "./chaos";
import { startMockServices } from "./mocks";
import { resilientCall, type AttemptRecord, type CallResult } from "./resilient";

const PUBLIC_HOST = "https://eortiz-space.se-demo.3b.run";
const FLAG_STAGE = "servicenow_flag_incomplete";

interface StageConfig {
  key: StageKey;
  label: string;
  service: string;
  action: string;
  timeoutMs: number;
  maxRetries: number;
}

const STAGE_CONFIG: StageConfig[] = [
  { key: "proofpoint_enrich", label: "Proofpoint enrichment", service: "proofpoint", action: "GET /v2/siem/messages/blocked", timeoutMs: 5000, maxRetries: 3 },
  { key: "zscaler_enrich", label: "Zscaler URL lookup", service: "zscaler", action: "GET /api/v1/urlLookup", timeoutMs: 4000, maxRetries: 3 },
  { key: "defender_query", label: "Defender device query", service: "defender", action: "POST /api/machines/query", timeoutMs: 6000, maxRetries: 4 },
  { key: "servicenow_create", label: "ServiceNow incident", service: "servicenow", action: "POST /api/now/table/incident", timeoutMs: 8000, maxRetries: 2 },
  { key: "endpoint_isolate", label: "Endpoint isolation", service: "defender", action: "POST /api/machines/{id}/isolate", timeoutMs: 8000, maxRetries: 2 },
];

interface StageRow {
  stage: string;
  status: string;
  attempts: number;
  status_code: number | null;
  classification: string | null;
  detail: string | null;
  result: string | null;
  duration_ms: number | null;
}

const db = openDb();
const executionStart = Date.now();
let relOffset = 0;

function relMs(): number {
  return relOffset + (Date.now() - executionStart);
}

function structuredLog(fields: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({ ts: nowIso(), workflow: "containment_with_guardrails", ...fields })}\n`);
}

function recordAttempt(
  runId: string,
  stage: string,
  fields: {
    attempt: number;
    event: string;
    level: string;
    outcome: string;
    statusCode: number | null;
    classification: string | null;
    latencyMs: number | null;
    message: string;
    extra?: Record<string, unknown>;
  },
): void {
  const payload = {
    run_id: runId,
    stage,
    attempt: fields.attempt,
    event: fields.event,
    outcome: fields.outcome,
    status_code: fields.statusCode,
    classification: fields.classification,
    latency_ms: fields.latencyMs,
    message: fields.message,
    ...(fields.extra ?? {}),
  };
  structuredLog({ level: fields.level, ...payload });
  db.query(
    `INSERT INTO attempt_log (run_id, ts, rel_ms, stage, attempt, event, level, outcome, status_code, classification, latency_ms, message, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    nowIso(),
    relMs(),
    stage,
    fields.attempt,
    fields.event,
    fields.level,
    fields.outcome,
    fields.statusCode,
    fields.classification,
    fields.latencyMs,
    fields.message,
    JSON.stringify(payload),
  );
}

function recordAudit(
  runId: string,
  fields: {
    stage: string;
    action: string;
    target: string;
    requestKey: string | null;
    attempt: number | null;
    outcome: string;
    statusCode: number | null;
    classification: string | null;
    latencyMs: number | null;
    detail: string;
  },
): void {
  db.query(
    `INSERT INTO audit_log (run_id, ts, rel_ms, actor, stage, action, target, request_key, attempt, outcome, status_code, classification, latency_ms, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    nowIso(),
    relMs(),
    "Containment Orchestrator",
    fields.stage,
    fields.action,
    fields.target,
    fields.requestKey,
    fields.attempt,
    fields.outcome,
    fields.statusCode,
    fields.classification,
    fields.latencyMs,
    fields.detail,
  );
}

function upsertStage(
  runId: string,
  stage: string,
  position: number,
  fields: {
    status: string;
    attempts?: number;
    startedRelMs?: number | null;
    durationMs?: number | null;
    timeoutMs?: number | null;
    maxRetries?: number | null;
    statusCode?: number | null;
    classification?: string | null;
    requestKey?: string | null;
    detail?: string | null;
    result?: unknown;
  },
): void {
  db.query(
    `INSERT INTO run_stages (run_id, stage, position, status, attempts, started_rel_ms, duration_ms, timeout_ms, max_retries, status_code, classification, request_key, detail, result, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, stage) DO UPDATE SET
       status = excluded.status,
       attempts = excluded.attempts,
       started_rel_ms = excluded.started_rel_ms,
       duration_ms = excluded.duration_ms,
       timeout_ms = excluded.timeout_ms,
       max_retries = excluded.max_retries,
       status_code = excluded.status_code,
       classification = excluded.classification,
       request_key = excluded.request_key,
       detail = excluded.detail,
       result = excluded.result,
       updated_at = excluded.updated_at`,
  ).run(
    runId,
    stage,
    position,
    fields.status,
    fields.attempts ?? 0,
    fields.startedRelMs ?? null,
    fields.durationMs ?? null,
    fields.timeoutMs ?? null,
    fields.maxRetries ?? null,
    fields.statusCode ?? null,
    fields.classification ?? null,
    fields.requestKey ?? null,
    fields.detail ?? null,
    fields.result === undefined ? null : JSON.stringify(fields.result),
    nowIso(),
  );
}

function updateRun(runId: string, fields: Record<string, string | number | null>): void {
  const keys = Object.keys(fields);
  const assignments = keys.map((key) => `${key} = ?`).join(", ");
  db.query(`UPDATE runs SET ${assignments}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]), nowIso(), runId);
}

function loadRun(runId: string): RunRow | null {
  return db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(runId);
}

function loadStages(runId: string): Map<string, StageRow> {
  const rows = db
    .query<StageRow, [string]>(
      "SELECT stage, status, attempts, status_code, classification, detail, result, duration_ms FROM run_stages WHERE run_id = ?",
    )
    .all(runId);
  return new Map(rows.map((row) => [row.stage, row]));
}

function parseResult<T>(row: StageRow | undefined): T | null {
  if (!row?.result) return null;
  try {
    return JSON.parse(row.result) as T;
  } catch {
    return null;
  }
}

async function executeStage(
  run: RunRow,
  config: StageConfig,
  position: number,
  target: string,
  requestKey: string | null,
  request: (signal: AbortSignal) => Promise<Response>,
): Promise<CallResult> {
  const startedRelMs = relMs();
  upsertStage(run.id, config.key, position, {
    status: "in_flight",
    attempts: 0,
    startedRelMs,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    requestKey,
    detail: "call in flight",
  });
  recordAttempt(run.id, config.key, {
    attempt: 0,
    event: "stage_start",
    level: "info",
    outcome: "started",
    statusCode: null,
    classification: null,
    latencyMs: null,
    message: `${config.label} started (timeout ${config.timeoutMs}ms, max ${config.maxRetries} retries)`,
    extra: { service: config.service, action: config.action, request_key: requestKey },
  });

  const onAttempt = (record: AttemptRecord) => {
    recordAttempt(run.id, config.key, {
      attempt: record.attempt,
      event: "attempt",
      level: record.outcome === "succeeded" ? "info" : record.outcome === "permanent" ? "error" : "warn",
      outcome: record.outcome,
      statusCode: record.statusCode,
      classification: record.classification,
      latencyMs: record.latencyMs,
      message: record.message,
      extra: {
        service: config.service,
        action: config.action,
        request_key: requestKey,
        retries_left: record.retriesLeft,
        retry_in_ms: record.retryInMs,
      },
    });
    recordAudit(run.id, {
      stage: config.key,
      action: `${config.service}: ${config.action}`,
      target,
      requestKey,
      attempt: record.attempt,
      outcome: record.outcome === "succeeded" ? "succeeded" : `failed_${record.classification}`,
      statusCode: record.statusCode,
      classification: record.classification,
      latencyMs: record.latencyMs,
      detail: record.message,
    });
    upsertStage(run.id, config.key, position, {
      status: record.outcome === "succeeded" ? "succeeded" : record.retryInMs !== null ? "retrying" : "in_flight",
      attempts: record.attempt,
      startedRelMs,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      statusCode: record.statusCode,
      classification: record.classification,
      requestKey,
      detail: record.message,
    });
  };

  const result = await resilientCall({
    stage: config.key,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    requestKey,
    request,
    onAttempt,
    onBackoff: ({ attempt, waitMs }) =>
      recordAttempt(run.id, config.key, {
        attempt,
        event: "backoff",
        level: "warn",
        outcome: "waiting",
        statusCode: null,
        classification: "transient",
        latencyMs: null,
        message: `backing off ${waitMs}ms before attempt ${attempt + 1}`,
        extra: { service: config.service, wait_ms: waitMs },
      }),
  });

  upsertStage(run.id, config.key, position, {
    status: result.ok ? "succeeded" : result.outcome,
    attempts: result.attempts,
    startedRelMs,
    durationMs: result.durationMs,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    statusCode: result.statusCode,
    classification: result.ok ? "success" : result.classification,
    requestKey,
    detail: result.message,
    result: result.ok ? result.body : null,
  });
  recordAttempt(run.id, config.key, {
    attempt: result.attempts,
    event: "stage_end",
    level: result.ok ? "info" : "error",
    outcome: result.ok ? "succeeded" : result.outcome,
    statusCode: result.statusCode,
    classification: result.ok ? "success" : result.classification,
    latencyMs: result.durationMs,
    message: result.ok
      ? `${config.label} succeeded after ${result.attempts} attempt(s)`
      : `${config.label} gave up after ${result.attempts} attempt(s): ${result.message}`,
    extra: { service: config.service, action: config.action },
  });
  return result;
}

async function main(): Promise<void> {
  const input = parseInput(await Bun.stdin.text());
  const payload = (input.body ?? {}) as { runId?: string; mode?: string; error?: string };
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  if (!runId) {
    // The upstream route rejected the request (validation, unknown run, nothing to resume):
    // there is no run to orchestrate, so stay quiet instead of failing the workflow.
    if (payload.error) {
      structuredLog({ level: "warn", event: "orchestrator_skipped", reason: payload.error });
      return;
    }
    throw new Error("orchestrator input is missing runId");
  }

  const run = loadRun(runId);
  if (!run) throw new Error(`run ${runId} not found in ${"/storage/containment_state"}`);

  const chaos: ChaosConfig = normalizeChaos(JSON.parse(run.chaos || "{}"));
  const existingStages = loadStages(runId);
  const maxRel =
    db.query<{ m: number | null }, [string]>("SELECT MAX(rel_ms) AS m FROM attempt_log WHERE run_id = ?").get(runId)?.m ?? null;
  relOffset = maxRel === null ? 0 : maxRel + 500;
  const isResume = (payload.mode ?? "start") === "resume";

  updateRun(runId, {
    status: "running",
    started_at: run.started_at ?? nowIso(),
    finished_at: null,
    failed_stage: null,
    failure_reason: null,
    failure_class: null,
    guardrail: null,
  });
  recordAttempt(runId, "run", {
    attempt: 0,
    event: isResume ? "run_resume" : "run_start",
    level: "info",
    outcome: "started",
    statusCode: null,
    classification: null,
    latencyMs: null,
    message: isResume ? `resuming run ${runId}` : `starting containment for ${run.endpoint}`,
    extra: { alert_id: run.alert_id, endpoint: run.endpoint, chaos: chaosSummary(chaos) },
  });
  recordAudit(runId, {
    stage: "run",
    action: isResume ? "run.resume" : "run.start",
    target: run.endpoint,
    requestKey: runId,
    attempt: null,
    outcome: "started",
    statusCode: null,
    classification: null,
    latencyMs: null,
    detail: `alert ${run.alert_id}, chaos: ${chaosSummary(chaos).join("; ") || "none"}`,
  });

  const mocks = startMockServices(db, runId, chaos);
  const skipped: string[] = [];
  let ticketNumber = run.ticket_number;
  let ticketSysId = run.ticket_sys_id;
  let ticketState = run.ticket_state;
  let isolationState = run.isolation_state;
  let failure: { stage: string; reason: string; classification: string; statusCode: number | null; attempts: number } | null = null;
  let guardrail: string | null = null;
  let clickedUrl = parseResult<{ clickedUrl?: string }>(existingStages.get("proofpoint_enrich"))?.clickedUrl ?? null;
  let machineId = parseResult<{ machineId?: string }>(existingStages.get("defender_query"))?.machineId ?? null;

  try {
    for (const [index, config] of STAGE_CONFIG.entries()) {
      const position = index + 1;
      const existing = existingStages.get(config.key);

      if (existing?.status === "succeeded") {
        skipped.push(config.key);
        recordAttempt(runId, config.key, {
          attempt: existing.attempts,
          event: "stage_skipped",
          level: "info",
          outcome: "already_complete",
          statusCode: existing.status_code,
          classification: "success",
          latencyMs: null,
          message: `${config.label} already completed in an earlier attempt — not repeated`,
          extra: { idempotent: true },
        });
        recordAudit(runId, {
          stage: config.key,
          action: `${config.service}: ${config.action}`,
          target: run.endpoint,
          requestKey: null,
          attempt: null,
          outcome: "skipped_already_complete",
          statusCode: existing.status_code,
          classification: "success",
          latencyMs: null,
          detail: "resume skipped a completed stage to avoid repeating side effects",
        });
        continue;
      }

      if (config.key === "endpoint_isolate" && !ticketNumber) {
        guardrail =
          "Isolation was NOT attempted: no ServiceNow incident exists, so containment would have left an untracked partial state.";
        upsertStage(runId, config.key, position, {
          status: "skipped_guardrail",
          timeoutMs: config.timeoutMs,
          maxRetries: config.maxRetries,
          detail: guardrail,
        });
        recordAttempt(runId, config.key, {
          attempt: 0,
          event: "guardrail_block",
          level: "error",
          outcome: "skipped_guardrail",
          statusCode: null,
          classification: null,
          latencyMs: null,
          message: guardrail,
        });
        recordAudit(runId, {
          stage: config.key,
          action: "defender: POST /api/machines/{id}/isolate",
          target: run.endpoint,
          requestKey: null,
          attempt: null,
          outcome: "not_attempted_guardrail",
          statusCode: null,
          classification: null,
          latencyMs: null,
          detail: guardrail,
        });
        break;
      }

      if (config.key === "endpoint_isolate" && !machineId) {
        machineId = `mde-fallback-${run.endpoint}`;
      }

      let result: CallResult;
      if (config.key === "proofpoint_enrich") {
        const target = `${mocks.baseUrl}/proofpoint/v2/siem/messages/blocked`;
        result = await executeStage(run, config, position, "proofpoint-tap", null, (signal) =>
          fetch(`${target}?alertId=${encodeURIComponent(run.alert_id)}`, { signal }),
        );
        if (result.ok) clickedUrl = (result.body as { clickedUrl?: string })?.clickedUrl ?? clickedUrl;
      } else if (config.key === "zscaler_enrich") {
        const url = clickedUrl ?? "https://secure-invoice-portal.top/login";
        result = await executeStage(run, config, position, url, null, (signal) =>
          fetch(`${mocks.baseUrl}/zscaler/api/v1/urlLookup?url=${encodeURIComponent(url)}`, { signal }),
        );
      } else if (config.key === "defender_query") {
        result = await executeStage(run, config, position, run.endpoint, null, (signal) =>
          fetch(`${mocks.baseUrl}/defender/api/machines/query`, {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: run.endpoint, userEmail: run.user_email }),
          }),
        );
        if (result.ok) machineId = (result.body as { machineId?: string })?.machineId ?? machineId;
      } else if (config.key === "servicenow_create") {
        const requestKey = `snow-create:${runId}`;
        result = await executeStage(run, config, position, "servicenow:incident", requestKey, (signal) =>
          fetch(`${mocks.baseUrl}/servicenow/api/now/table/incident`, {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey },
            body: JSON.stringify({
              short_description: `Phishing containment for ${run.endpoint} (${run.alert_id})`,
              description: `Automated containment run ${runId}. Alert ${run.alert_id}, user ${run.user_email}.`,
              urgency: run.severity === "critical" ? "1" : run.severity === "high" ? "2" : "3",
              category: "security",
              assignment_group: "SOC Tier 2",
              u_endpoint: run.endpoint,
              u_containment_status: "in progress",
            }),
          }),
        );
        if (result.ok) {
          const ticket = (result.body as { result?: { number?: string; sys_id?: string; state?: string } })?.result ?? {};
          ticketNumber = ticket.number ?? null;
          ticketSysId = ticket.sys_id ?? null;
          ticketState = ticket.state ?? "New";
          updateRun(runId, { ticket_number: ticketNumber, ticket_sys_id: ticketSysId, ticket_state: ticketState });
        }
      } else {
        const requestKey = `isolate:${runId}:${machineId}`;
        result = await executeStage(run, config, position, machineId ?? run.endpoint, requestKey, (signal) =>
          fetch(`${mocks.baseUrl}/defender/api/machines/${encodeURIComponent(machineId!)}/isolate`, {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey },
            body: JSON.stringify({ Comment: `Containment run ${runId} / ${ticketNumber}`, IsolationType: "Full" }),
          }),
        );
        if (result.ok) {
          isolationState = (result.body as { status?: string })?.status === "AlreadyIsolated" ? "Isolated (idempotent replay)" : "Isolated";
          updateRun(runId, { isolation_state: isolationState });
        }
      }

      if (!result.ok) {
        failure = {
          stage: config.key,
          reason: result.message,
          classification: result.classification,
          statusCode: result.statusCode,
          attempts: result.attempts,
        };
        break;
      }
    }

    // Guardrail: a ticket that exists but an endpoint that is not isolated must not stay silent.
    if (failure?.stage === "endpoint_isolate" && ticketNumber && ticketSysId) {
      guardrail = `Endpoint is NOT isolated but ${ticketNumber} exists — the incident was flagged "containment incomplete" for the analyst.`;
      const flagConfig: StageConfig = {
        key: FLAG_STAGE as StageKey,
        label: "Flag incident containment incomplete",
        service: "servicenow",
        action: "PATCH /api/now/table/incident/{sys_id}",
        timeoutMs: 8000,
        maxRetries: 2,
      };
      const flagResult = await executeStage(run, flagConfig, 6, `servicenow:${ticketNumber}`, `snow-flag:${runId}`, (signal) =>
        fetch(`${mocks.baseUrl}/servicenow/api/now/table/incident/${encodeURIComponent(ticketSysId!)}`, {
          method: "PATCH",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state: "On Hold",
            u_containment_status: "containment incomplete",
            work_notes: `Isolation failed after ${failure.attempts} attempt(s) (${failure.classification}, status ${failure.statusCode ?? "none"}): ${failure.reason}. Endpoint ${run.endpoint} is NOT contained. Analyst action required.`,
          }),
        }),
      );
      ticketState = flagResult.ok ? "containment incomplete" : `${ticketState ?? "New"} (flagging failed)`;
      isolationState = isolationState ?? "Not isolated";
      updateRun(runId, { ticket_state: ticketState, isolation_state: isolationState });
    }

    if (failure?.stage === "servicenow_create") {
      guardrail =
        guardrail ??
        "Isolation was NOT attempted because ServiceNow incident creation failed — no containment action was taken, so there is no partial state.";
      upsertStage(runId, "endpoint_isolate", 5, {
        status: "skipped_guardrail",
        timeoutMs: 8000,
        maxRetries: 2,
        detail: guardrail,
      });
      recordAttempt(runId, "endpoint_isolate", {
        attempt: 0,
        event: "guardrail_block",
        level: "error",
        outcome: "skipped_guardrail",
        statusCode: null,
        classification: null,
        latencyMs: null,
        message: guardrail,
      });
      recordAudit(runId, {
        stage: "endpoint_isolate",
        action: "defender: POST /api/machines/{id}/isolate",
        target: run.endpoint,
        requestKey: null,
        attempt: null,
        outcome: "not_attempted_guardrail",
        statusCode: null,
        classification: null,
        latencyMs: null,
        detail: guardrail,
      });
    }
    if (failure && failure.stage !== "endpoint_isolate" && failure.stage !== "servicenow_create") {
      guardrail = "Failure happened during enrichment: no ticket was created and no containment action was taken.";
    }

    for (const [index, config] of STAGE_CONFIG.entries()) {
      const stageRow = loadStages(runId).get(config.key);
      if (!stageRow) {
        upsertStage(runId, config.key, index + 1, {
          status: "pending",
          timeoutMs: config.timeoutMs,
          maxRetries: config.maxRetries,
          detail: failure ? "not reached — run stopped at an earlier failure" : "pending",
        });
      }
    }

    const stages = loadStages(runId);
    const allSucceeded = STAGE_KEYS.every((key) => stages.get(key)?.status === "succeeded");

    // A resumed run that finally isolated the endpoint must clear the "containment incomplete" flag.
    if (allSucceeded && ticketSysId && ticketState === "containment incomplete") {
      const clearConfig: StageConfig = {
        key: "servicenow_clear_flag" as StageKey,
        label: "Clear incident containment flag",
        service: "servicenow",
        action: "PATCH /api/now/table/incident/{sys_id}",
        timeoutMs: 8000,
        maxRetries: 2,
      };
      const clearResult = await executeStage(run, clearConfig, 7, `servicenow:${ticketNumber}`, `snow-clear:${runId}`, (signal) =>
        fetch(`${mocks.baseUrl}/servicenow/api/now/table/incident/${encodeURIComponent(ticketSysId!)}`, {
          method: "PATCH",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state: "In Progress",
            u_containment_status: "contained",
            work_notes: `Containment completed on resume #${run.resume_count}. Endpoint ${run.endpoint} is isolated.`,
          }),
        }),
      );
      if (clearResult.ok) {
        ticketState = "contained";
        updateRun(runId, { ticket_state: ticketState });
      }
    }

    const status = allSucceeded
      ? "contained"
      : failure?.stage === "endpoint_isolate"
        ? "partial"
        : failure?.stage === "servicenow_create"
          ? "blocked"
          : "failed";

    updateRun(runId, {
      status,
      finished_at: nowIso(),
      failed_stage: failure?.stage ?? null,
      failure_reason: failure?.reason ?? null,
      failure_class: failure?.classification ?? null,
      guardrail,
      safe_to_retry: status === "contained" ? 0 : 1,
      isolation_state: isolationState ?? (status === "contained" ? "Isolated" : "Not isolated"),
    });

    recordAttempt(runId, "run", {
      attempt: 0,
      event: "run_end",
      level: status === "contained" ? "info" : "error",
      outcome: status,
      statusCode: failure?.statusCode ?? null,
      classification: failure?.classification ?? null,
      latencyMs: Date.now() - executionStart,
      message:
        status === "contained"
          ? `containment complete for ${run.endpoint} (${ticketNumber})`
          : `run ended as ${status}: ${failure?.reason ?? "unknown"}`,
      extra: { ticket: ticketNumber, isolation: isolationState, guardrail },
    });
    recordAudit(runId, {
      stage: "run",
      action: "run.finish",
      target: run.endpoint,
      requestKey: runId,
      attempt: null,
      outcome: status,
      statusCode: failure?.statusCode ?? null,
      classification: failure?.classification ?? null,
      latencyMs: Date.now() - executionStart,
      detail: guardrail ?? `ticket ${ticketNumber ?? "none"}, isolation ${isolationState ?? "none"}`,
    });

    const succeededStages = STAGE_CONFIG.filter((config) => stages.get(config.key)?.status === "succeeded").map((config) => ({
      stage: config.key,
      label: config.label,
      attempts: stages.get(config.key)?.attempts ?? 0,
    }));
    const resumeFrom = failure?.stage ?? null;
    const consoleUrl = `${PUBLIC_HOST}${branchPrefix()}/containment`;

    const summary = {
      runId,
      status,
      notify: status !== "contained",
      alertId: run.alert_id,
      endpoint: run.endpoint,
      userEmail: run.user_email,
      severity: run.severity,
      chaos: chaosSummary(chaos),
      resumeCount: run.resume_count,
      succeeded: succeededStages,
      skipped,
      failed: failure,
      guardrail,
      systemState: {
        ticketNumber,
        ticketState,
        isolationState: isolationState ?? "Not isolated",
        contained: status === "contained",
        safeToRetry: status !== "contained",
        idempotencyKeys: {
          servicenow: `snow-create:${runId}`,
          isolation: machineId ? `isolate:${runId}:${machineId}` : null,
        },
      },
      resumeFrom,
      willSkipOnResume: STAGE_CONFIG.filter((config) => stages.get(config.key)?.status === "succeeded").map((config) => config.key),
      consoleUrl,
      retryUrl: resumeFrom ? `${consoleUrl}?resume=${encodeURIComponent(runId)}` : consoleUrl,
      durationMs: Date.now() - executionStart,
    };

    process.stdout.write(JSON.stringify(summary));
  } finally {
    mocks.stop();
  }
}

await main();
db.close();
process.exit(0);
