import { appendFileSync, existsSync } from "node:fs";

const WORKFLOW = "Azure RG lifecycle automation";
const AUDIT_DIR = "/storage/audit";
const runId = process.env._3B_RUN_ID;
let stepName = "unknown";

type Level = "debug" | "info" | "warn" | "error";
type Outcome = "success" | "failure" | "skipped" | "attempted";

export function setStep(name: string) {
  stepName = name;
}

export function log(
  level: Level,
  event: string,
  msg: string,
  extra: Record<string, unknown> = {},
) {
  const record = {
    ts: new Date().toISOString(),
    level,
    step: stepName,
    event,
    msg,
    ...(runId ? { run_id: runId } : {}),
    ...extra,
  };
  process.stderr.write(JSON.stringify(record) + "\n");
}

export function audit(
  action: string,
  target: string,
  outcome: Outcome,
  detail: Record<string, unknown> = {},
) {
  if (!existsSync(AUDIT_DIR)) {
    log("warn", "audit_unavailable", "Audit volume not mounted.", { action });
    return;
  }
  const ts = new Date().toISOString();
  const record = {
    ts,
    workflow: WORKFLOW,
    step: stepName,
    ...(runId ? { run_id: runId } : {}),
    action,
    target,
    outcome,
    detail,
  };
  const file = `${AUDIT_DIR}/${ts.slice(0, 10)}.jsonl`;
  appendFileSync(file, JSON.stringify(record) + "\n");
}

export async function main(name: string, fn: () => Promise<void>) {
  setStep(name);
  try {
    await fn();
  } catch (err) {
    const e = err as Error;
    log("error", "step_failed", e.message, { error: e.name });
    process.exit(1);
  }
}
