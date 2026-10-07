import { openDb, saveSubmission, appendAudit, raiseSecurityEvent } from "./db";

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("event=intake.record.failed reason=no_input");
  process.exit(1);
}
const s = JSON.parse(raw);
const scan = s.scan ?? { findings: [], risk_score: 0, scan_verdict: "auto-approve" };
const modelPolicy = s.model_policy ?? { compliant: true, rule_id: null, rule_fired: null };
const bypass = s.bypass ?? { bypass_attempt: false, reasons: [] };

const policiesFired = [
  ...scan.findings.map((f: any) => f.rule_id),
  ...(modelPolicy.compliant ? [] : [modelPolicy.rule_id]),
  ...bypass.reasons.map((r: any) => r.rule_id),
];

let status: string;
let reason: string;
if (bypass.bypass_attempt) {
  status = "blocked";
  reason = "Ungoverned origin — submission did not originate from a sanctioned pipeline, repo, or runner.";
} else if (scan.scan_verdict === "auto-block") {
  status = "blocked";
  reason = `Policy scan risk score ${scan.risk_score} exceeds the auto-block threshold of 70.`;
} else if (!modelPolicy.compliant) {
  status = "pending";
  reason = `Model policy violation (${modelPolicy.rule_id}) — mandatory security review before promotion.`;
} else if (scan.scan_verdict === "auto-approve") {
  status = "auto-approved";
  reason = `Policy scan risk score ${scan.risk_score} is below the auto-approve threshold of 20 and all policies passed.`;
} else {
  status = "pending";
  reason = `Policy scan risk score ${scan.risk_score} requires human review.`;
}

const db = openDb();
const record = {
  submission_id: s.submission_id,
  received_at: s.received_at,
  developer_name: s.developer_name,
  developer_email: s.developer_email,
  team: s.team,
  region: s.region,
  source_tool: s.source_tool,
  model_used: s.model_used,
  repo: s.repo,
  branch: s.branch,
  commit_sha: s.commit_sha,
  description: s.description,
  code_payload: s.code_payload,
  risk_score: scan.risk_score,
  scan_verdict: scan.scan_verdict,
  findings: scan.findings,
  model_policy: modelPolicy,
  bypass: { ...bypass, pipeline: s.pipeline, runner: s.runner },
  credentials: s.credentials ?? null,
  status,
  reviewer: status === "auto-approved" ? "3b-gateway (automated)" : status === "blocked" ? "3b-gateway (automated)" : null,
  reviewer_comment: status === "pending" ? null : reason,
  decided_at: status === "pending" ? null : new Date().toISOString(),
  decision_seconds: status === "pending" ? null : Math.max(1, (Date.now() - new Date(s.received_at).getTime()) / 1000),
};
saveSubmission(db, record);

appendAudit(db, {
  submission_id: s.submission_id,
  actor: `${s.developer_name} via ${s.source_tool}`,
  action: "submission.received",
  policies_fired: policiesFired,
  disposition: status,
  comment: reason,
  detail: {
    risk_score: scan.risk_score,
    scan_verdict: scan.scan_verdict,
    model_policy_rule: modelPolicy.rule_id,
    model_policy_compliant: modelPolicy.compliant,
    bypass_attempt: bypass.bypass_attempt,
    repo: s.repo,
    branch: s.branch,
    commit_sha: s.commit_sha,
    credential_names: (s.credentials?.references ?? []).map((c: any) => c.name),
  },
});

if (bypass.bypass_attempt) {
  raiseSecurityEvent(db, {
    submission_id: s.submission_id,
    severity: "critical",
    kind: "bypass_attempt",
    message: `Blocked ungoverned deployment from ${s.repo} (runner ${s.runner}) by ${s.developer_name}.`,
  });
}
if (!modelPolicy.compliant) {
  raiseSecurityEvent(db, {
    submission_id: s.submission_id,
    severity: "high",
    kind: "model_policy_violation",
    message: `${s.model_used} used by ${s.team} / ${s.region} violates ${modelPolicy.rule_id}.`,
  });
}
db.close();

console.error(
  `event=intake.recorded submission=${s.submission_id} status=${status} risk_score=${scan.risk_score} policies_fired="${policiesFired.join(",") || "none"}" reason="${reason}"`,
);

process.stdout.write(JSON.stringify({ ...s, status, disposition_reason: reason, policies_fired: policiesFired }));
