import { appendFileSync, mkdirSync } from "node:fs";

export function log(level: string, event: string, msg: string, detail: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level, step: "Chase Overdue Tickets", event, msg, ...detail }));
}

export function audit(runId: string, action: string, target: string, outcome: string, detail: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  mkdirSync("/storage/audit", { recursive: true });
  appendFileSync(`/storage/audit/${ts.slice(0, 10)}.jsonl`, JSON.stringify({ ts, workflow: "Qualys Finding to Remediation", step: "Chase Overdue Tickets", run_id: runId, action, target, outcome, detail }) + "\n");
}
