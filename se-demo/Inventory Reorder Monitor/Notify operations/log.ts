import { appendFile } from "node:fs/promises";

export const WORKFLOW = "Inventory Reorder Monitor";

type Level = "debug" | "info" | "warn" | "error";

export type Logger = (
  level: Level,
  event: string,
  msg: string,
  extra?: Record<string, unknown>,
) => void;

export function makeLogger(step: string, runId?: string): Logger {
  return (level, event, msg, extra = {}) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        step,
        event,
        msg,
        ...(runId ? { run_id: runId } : {}),
        ...extra,
      }),
    );
  };
}

export type AuditRecord = {
  step: string;
  run_id?: string;
  action: string;
  target: string;
  outcome: "success" | "failure" | "skipped" | "attempted";
  detail?: Record<string, unknown>;
};

export async function audit(record: AuditRecord): Promise<void> {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, workflow: WORKFLOW, ...record }) + "\n";
  await appendFile(`/storage/audit/${ts.slice(0, 10)}.jsonl`, line);
}
