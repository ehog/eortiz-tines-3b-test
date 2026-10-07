import { createHash } from "node:crypto";
import { openDb, saveSubmission } from "./db";

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("event=deploy.failed reason=no_input");
  process.exit(1);
}
const s = JSON.parse(raw);
const approved = s.status === "auto-approved" || s.status === "approved";

if (!approved) {
  console.error(
    `event=deploy.skipped submission=${s.submission_id} status=${s.status} reason="Promotion withheld — the gateway did not reach an approved disposition."`,
  );
  process.stdout.write(JSON.stringify({ ...s, deployment: null }));
  process.exit(0);
}

const digest = createHash("sha256").update(`${s.submission_id}:${s.commit_sha}`).digest("hex").slice(0, 8).toUpperCase();
const deployment_id = `DEP-${digest}`;
const namespace = `prod-${String(s.team).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(s.region).toLowerCase()}`;
const deployed_at = new Date().toISOString();

const deployment = {
  deployment_id,
  namespace,
  target: `${namespace}.dentsplysirona.internal`,
  artifact: `${s.repo}@${s.commit_sha}`,
  deployed_at,
  simulated: true,
  credential_used: (s.credentials?.references ?? [])[0]?.name ?? "ds-deploy-token",
};

const db = openDb();
const row = db.query("SELECT * FROM submissions WHERE submission_id = ?").get(s.submission_id) as any;
if (row) {
  saveSubmission(db, {
    ...row,
    status: "deployed",
    deployment_id,
    deployed_at,
    decided_at: row.decided_at ?? deployed_at,
  });
}
db.close();

console.error(
  `event=deploy.completed submission=${s.submission_id} deployment=${deployment_id} namespace=${namespace} artifact=${deployment.artifact} credential=${deployment.credential_used} simulated=true`,
);

process.stdout.write(JSON.stringify({ ...s, status: "deployed", deployment }));
