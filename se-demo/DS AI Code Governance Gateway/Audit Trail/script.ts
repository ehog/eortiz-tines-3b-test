import { openDb, appendAudit } from "./db";

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("event=audit.failed reason=no_input");
  process.exit(1);
}
const s = JSON.parse(raw);
const db = openDb();

const action = s.deployment ? "deployment.promoted" : `disposition.${s.status}`;
appendAudit(db, {
  submission_id: s.submission_id,
  actor: s.reviewer ?? "3b-gateway (automated)",
  action,
  policies_fired: s.policies_fired ?? [],
  comment: s.reviewer_comment ?? s.disposition_reason ?? "",
  disposition: s.status,
  detail: {
    deployment_id: s.deployment?.deployment_id ?? null,
    namespace: s.deployment?.namespace ?? null,
    artifact: s.deployment?.artifact ?? `${s.repo}@${s.commit_sha}`,
    risk_score: s.scan?.risk_score ?? null,
    model_policy_rule: s.model_policy?.rule_id ?? null,
    immutable: true,
  },
});
const total = (db.query("SELECT COUNT(*) AS c FROM audit").get() as any).c;
db.close();

console.error(
  `event=audit.appended submission=${s.submission_id} action=${action} disposition=${s.status} actor="${s.reviewer ?? "3b-gateway (automated)"}" policies="${(s.policies_fired ?? []).join(",") || "none"}" ledger_records=${total}`,
);

process.stdout.write(JSON.stringify(s));
