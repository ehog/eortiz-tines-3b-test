import { openDb, saveSubmission, appendAudit } from "./db";

function httpError(code: number, reason: string, payload: unknown): never {
  const json = JSON.stringify(payload);
  process.stdout.write(
    `HTTP/1.1 ${code} ${reason}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`,
  );
  process.exit(0);
}

const raw = await Bun.stdin.text();
const sepIdx = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
const body = sepIdx === -1 ? "" : raw.slice(sepIdx + (raw.indexOf("\r\n\r\n") >= 0 ? 4 : 2));

let req: Record<string, any>;
try {
  req = JSON.parse(body.trim() || "{}");
} catch {
  console.error("event=decision.rejected reason=invalid_json");
  httpError(400, "Bad Request", { error: "body must be JSON" });
}

const DECISIONS = ["approve", "reject", "request-changes"];
const { submission_id, decision, reviewer, comment } = req;
if (!submission_id || !DECISIONS.includes(decision) || !reviewer || !String(comment ?? "").trim()) {
  console.error(`event=decision.rejected reason=invalid_request submission=${submission_id ?? "none"} decision=${decision ?? "none"}`);
  httpError(422, "Unprocessable Entity", {
    error: "submission_id, decision (approve|reject|request-changes), reviewer and a non-empty comment are all required",
  });
}

const db = openDb();
const row = db.query("SELECT * FROM submissions WHERE submission_id = ?").get(submission_id) as any;
if (!row) {
  db.close();
  console.error(`event=decision.rejected reason=unknown_submission submission=${submission_id}`);
  httpError(404, "Not Found", { error: `unknown submission ${submission_id}` });
}
if (row.status !== "pending") {
  db.close();
  console.error(`event=decision.rejected reason=already_decided submission=${submission_id} status=${row.status}`);
  httpError(409, "Conflict", { error: `submission ${submission_id} is already ${row.status}` });
}

const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes-requested";
const decided_at = new Date().toISOString();
const decision_seconds = Math.max(1, (Date.parse(decided_at) - Date.parse(row.received_at)) / 1000);
const findings = JSON.parse(row.findings || "[]");
const model_policy = JSON.parse(row.model_policy || "{}");
const bypass = JSON.parse(row.bypass || "{}");
const credentials = JSON.parse(row.credentials || "null");
const policies_fired = [
  ...findings.map((f: any) => f.rule_id),
  ...(model_policy.compliant === false ? [model_policy.rule_id] : []),
  ...((bypass.reasons ?? []).map((r: any) => r.rule_id)),
];

saveSubmission(db, {
  ...row,
  status,
  reviewer,
  reviewer_comment: String(comment).trim(),
  decided_at,
  decision_seconds,
});
appendAudit(db, {
  ts: decided_at,
  submission_id,
  actor: reviewer,
  action: `review.${decision}`,
  policies_fired,
  comment: String(comment).trim(),
  disposition: status,
  detail: { decision_seconds, risk_score: row.risk_score, human_gate: true },
});
db.close();

console.error(
  `event=review.decided submission=${submission_id} decision=${decision} status=${status} reviewer="${reviewer}" decision_seconds=${decision_seconds.toFixed(1)} policies="${policies_fired.join(",") || "none"}"`,
);

process.stdout.write(
  JSON.stringify({
    submission_id,
    received_at: row.received_at,
    developer_name: row.developer_name,
    developer_email: row.developer_email,
    team: row.team,
    region: row.region,
    source_tool: row.source_tool,
    model_used: row.model_used,
    repo: row.repo,
    branch: row.branch,
    commit_sha: row.commit_sha,
    description: row.description,
    scan: { findings, risk_score: row.risk_score, scan_verdict: row.scan_verdict },
    model_policy,
    bypass,
    credentials,
    status,
    reviewer,
    reviewer_comment: String(comment).trim(),
    policies_fired,
  }),
);
