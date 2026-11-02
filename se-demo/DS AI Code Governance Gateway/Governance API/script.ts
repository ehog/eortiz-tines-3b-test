import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { DB_PATH } from "./db";
import { RULES, POLICY_VERSION, MODELS, TEAMS, REGIONS } from "./model-policy";
import { SANCTIONED_REPOS, SANCTIONED_PIPELINES, SANCTIONED_RUNNERS } from "./bypass";

await Bun.stdin.text();

function respond(payload: unknown) {
  const json = JSON.stringify(payload);
  process.stdout.write(
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`,
  );
}

const policy = {
  version: POLICY_VERSION,
  models: MODELS,
  teams: TEAMS,
  regions: REGIONS,
  rules: RULES,
  sanctioned_repos: SANCTIONED_REPOS,
  sanctioned_pipelines: SANCTIONED_PIPELINES,
  sanctioned_runners: SANCTIONED_RUNNERS,
};

if (!existsSync(DB_PATH)) {
  console.error("event=api.served state=empty submissions=0 note=\"run Seed Demo Data to populate the ledger\"");
  respond({ generated_at: new Date().toISOString(), seeded: false, submissions: [], audit: [], security_events: [], policy });
  process.exit(0);
}

const db = new Database(DB_PATH, { readonly: true });
const rows = db.query("SELECT * FROM submissions ORDER BY received_at DESC").all() as any[];
const submissions = rows.map((r) => ({
  ...r,
  findings: JSON.parse(r.findings || "[]"),
  model_policy: JSON.parse(r.model_policy || "{}"),
  bypass: JSON.parse(r.bypass || "{}"),
  credentials: JSON.parse(r.credentials || "null"),
}));
const audit = (db.query("SELECT * FROM audit ORDER BY id DESC").all() as any[]).map((a) => ({
  ...a,
  policies_fired: JSON.parse(a.policies_fired || "[]"),
  detail: JSON.parse(a.detail || "{}"),
}));
const security_events = db.query("SELECT * FROM security_events ORDER BY id DESC").all() as any[];
db.close();

console.error(
  `event=api.served submissions=${submissions.length} pending=${submissions.filter((s) => s.status === "pending").length} audit_records=${audit.length} security_events=${security_events.length} policy_version=${POLICY_VERSION}`,
);

respond({ generated_at: new Date().toISOString(), seeded: true, submissions, audit, security_events, policy });
