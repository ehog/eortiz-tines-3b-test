import { createHash } from "node:crypto";
import { openDb, saveSubmission, appendAudit, raiseSecurityEvent } from "./db";
import { scanPayload } from "./scan";
import { detectBypass } from "./bypass";
import { evaluateModelPolicy } from "./model-policy";

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260214);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

const TEAMS = ["R&D-Endodontics", "Digital Dentistry", "IT-Ops", "Clinical Data"] as const;
const REGIONS = ["US", "DE", "JP"] as const;
const TOOLS = ["claude-code", "github-copilot", "3b-native"] as const;

const DEVELOPERS = [
  { name: "Lena Hoffmann", email: "lena.hoffmann@dentsplysirona.com", team: "R&D-Endodontics", region: "DE" },
  { name: "Marcus Feld", email: "marcus.feld@dentsplysirona.com", team: "R&D-Endodontics", region: "US" },
  { name: "Priya Raghavan", email: "priya.raghavan@dentsplysirona.com", team: "Digital Dentistry", region: "US" },
  { name: "Tobias Krieger", email: "tobias.krieger@dentsplysirona.com", team: "Digital Dentistry", region: "DE" },
  { name: "Kenji Watanabe", email: "kenji.watanabe@dentsplysirona.com", team: "Digital Dentistry", region: "JP" },
  { name: "Dana Whitfield", email: "dana.whitfield@dentsplysirona.com", team: "IT-Ops", region: "US" },
  { name: "Ahmet Yilmaz", email: "ahmet.yilmaz@dentsplysirona.com", team: "IT-Ops", region: "DE" },
  { name: "Sofia Marchetti", email: "sofia.marchetti@dentsplysirona.com", team: "Clinical Data", region: "US" },
  { name: "Aiko Tanaka", email: "aiko.tanaka@dentsplysirona.com", team: "Clinical Data", region: "JP" },
  { name: "Ryan Dolan", email: "ryan.dolan@dentsplysirona.com", team: "IT-Ops", region: "US" },
] as const;

const REPO_BY_TEAM: Record<string, string> = {
  "R&D-Endodontics": "dentsplysirona/endo-automation",
  "Digital Dentistry": "dentsplysirona/digital-dentistry-agents",
  "IT-Ops": "dentsplysirona/itops-runbooks",
  "Clinical Data": "dentsplysirona/clinical-data-platform",
};

const PIPELINE_BY_TOOL: Record<string, string> = {
  "claude-code": "ds-github-actions-prod",
  "github-copilot": "ds-azure-devops-prod",
  "3b-native": "ds-3b-native-deploy",
};
const RUNNER_BY_TOOL: Record<string, string> = {
  "claude-code": "sanctioned-github-actions",
  "github-copilot": "ds-azure-hosted-runner",
  "3b-native": "3b-managed-runner",
};

type Template = { key: string; description: string; code: string };

const CLEAN_TEMPLATES: Template[] = [
  {
    key: "clean-instrument-sync",
    description: "Nightly sync of endodontic instrument telemetry into the reliability dashboard",
    code: `import os, requests

def sync_instrument_telemetry(batch):
    token = os.environ["DS_TELEMETRY_TOKEN"]
    try:
        resp = requests.post(
            "https://api.dentsplysirona.com/telemetry/v2/instruments",
            json={"batch": batch},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError("telemetry sync failed") from exc
    return resp.json()["accepted"]
`,
  },
  {
    key: "clean-scanner-firmware-report",
    description: "Weekly intraoral scanner firmware drift report for field service",
    code: `import os, requests

def firmware_drift_report():
    key = os.environ["DS_FLEET_TOKEN"]
    try:
        r = requests.get(
            "https://internal.dentsplysirona.net/fleet/firmware",
            headers={"Authorization": f"Bearer {key}"},
            timeout=20,
        )
        r.raise_for_status()
    except requests.RequestException:
        raise
    return [d for d in r.json()["devices"] if d["version"] != d["target_version"]]
`,
  },
  {
    key: "clean-ticket-triage",
    description: "Triage inbound IT tickets and route by product line",
    code: `import os, requests

ROUTES = {"scanner": "field-service", "cad": "digital-dentistry", "default": "it-helpdesk"}

def triage(ticket):
    queue = ROUTES.get(ticket.get("product_line"), ROUTES["default"])
    try:
        resp = requests.post(
            "https://internal.dentsplysirona.net/itsm/route",
            json={"ticket_id": ticket["id"], "queue": queue},
            headers={"Authorization": f"Bearer {os.environ['DS_ITSM_TOKEN']}"},
            timeout=10,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError("routing failed") from exc
    return queue
`,
  },
];

const RISKY_TEMPLATES: Template[] = [
  {
    key: "secret-hardcoded",
    description: "Push CAD job metrics into the reliability warehouse",
    code: `import requests

api_key = "ak_live_9fJ2mWq7ZbT4rL8dPx1cVn"

def push_metrics(rows):
    requests.post(
        "https://api.dentsplysirona.com/warehouse/cad-jobs",
        json={"rows": rows},
        headers={"X-Api-Key": api_key},
    )
`,
  },
  {
    key: "phi-export",
    description: "Export treatment history for the outcomes analytics model",
    code: `import os, requests

def export_cases(cursor):
    query = """
        SELECT patient_id, mrn, date_of_birth, treatment_history
        FROM clinical_records
        WHERE updated_at > %s
    """
    cursor.execute(query, (last_run(),))
    rows = cursor.fetchall()
    requests.post(
        "https://api.dentsplysirona.com/analytics/outcomes",
        json={"records": rows},
        headers={"Authorization": f"Bearer {os.environ['DS_ANALYTICS_TOKEN']}"},
        timeout=30,
    )
    return len(rows)
`,
  },
  {
    key: "egress-unallowlisted",
    description: "Enrich supplier records using an external data provider",
    code: `import requests

def enrich(suppliers):
    out = []
    for s in suppliers:
        r = requests.get("https://api.rapid-enrich.io/v1/company", params={"q": s["name"]}, verify=False)
        out.append(r.json())
    return out
`,
  },
  {
    key: "unscoped-credentials",
    description: "Bulk reconcile device registrations across regions",
    code: `import os, requests

CONFIG = {"scope": "*", "role": "admin"}

def reconcile(devices):
    token = os.environ["DS_FLEET_TOKEN"]
    for d in devices:
        requests.put(
            f"https://internal.dentsplysirona.net/fleet/devices/{d['id']}",
            json={**d, **CONFIG},
            headers={"Authorization": f"Bearer {token}"},
        )
`,
  },
  {
    key: "shell-exec",
    description: "Rotate log archives on the imaging file share",
    code: `import os, subprocess

def rotate(share, days=30):
    cmd = f"find {share} -name '*.log' -mtime +{days} -delete"
    subprocess.run(cmd, shell=True)
    os.system(f"tar czf /backups/{share}.tgz {share}")
`,
  },
  {
    key: "critical-multi",
    description: "One-off migration of legacy patient scheduling exports",
    code: `import requests

password = "Ds!Migrate2026"
access_token = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"

def migrate(rows):
    for r in rows:
        requests.post(
            "https://legacy-migrate.northwind-tools.net/import",
            json={"patient_id": r["patient_id"], "dob": r["dob"], "mrn": r["mrn"]},
            headers={"Authorization": f"Bearer {access_token}", "X-Pass": password},
            verify=False,
        )
`,
  },
];

const NOW = Date.now();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function commitFor(seed: string) {
  return createHash("sha1").update(seed).digest("hex").slice(0, 7);
}

type Seeded = {
  submission_id: string;
  received_at: string;
  developer_name: string;
  developer_email: string;
  team: string;
  region: string;
  source_tool: string;
  model_used: string;
  repo: string;
  branch: string;
  commit_sha: string;
  description: string;
  code_payload: string;
  pipeline: string;
  runner: string;
  forced_status?: string;
  reviewer?: string;
  reviewer_comment?: string;
};

const compliantModel = (team: string, region: string) => {
  const rule = evaluateModelPolicy(team, region, "claude-sonnet-4-5");
  return rule.compliant ? "claude-sonnet-4-5" : rule.allowed_models[0] ?? "azure-foundry-claude";
};

const rows: Seeded[] = [];
let counter = 0;

function idFor(ts: number) {
  counter += 1;
  const d = new Date(ts).toISOString().slice(0, 10).replaceAll("-", "");
  return `SUB-${d}-${String(1000 + counter).slice(1)}`;
}

for (let i = 0; i < 40; i++) {
  const dev = DEVELOPERS[i % DEVELOPERS.length];
  const ts = NOW - Math.floor(rand() * 13 * DAY + 2 * HOUR);
  const tool = pick(TOOLS);
  const risky = rand() < 0.45;
  const tpl = risky ? pick(RISKY_TEMPLATES) : pick(CLEAN_TEMPLATES);
  const useViolation = rand() < 0.12;
  const model = useViolation
    ? (dev.team === "Clinical Data" ? "gpt-4o" : dev.region === "DE" ? "gemini-2.5-pro" : "gemini-2.5-pro")
    : compliantModel(dev.team, dev.region);
  rows.push({
    submission_id: idFor(ts),
    received_at: new Date(ts).toISOString(),
    developer_name: dev.name,
    developer_email: dev.email,
    team: dev.team,
    region: dev.region,
    source_tool: tool,
    model_used: model,
    repo: REPO_BY_TEAM[dev.team],
    branch: `feature/${tpl.key}`,
    commit_sha: commitFor(`${i}:${tpl.key}`),
    description: tpl.description,
    code_payload: tpl.code,
    pipeline: PIPELINE_BY_TOOL[tool],
    runner: RUNNER_BY_TOOL[tool],
  });
}

const bypassTs = NOW - 5 * HOUR;
rows.push({
  submission_id: idFor(bypassTs),
  received_at: new Date(bypassTs).toISOString(),
  developer_name: "Ryan Dolan",
  developer_email: "ryan.dolan@dentsplysirona.com",
  team: "IT-Ops",
  region: "US",
  source_tool: "claude-code",
  model_used: "claude-sonnet-4-5",
  repo: "rdolan-personal/ds-quick-scripts",
  branch: "main",
  commit_sha: commitFor("bypass-historic"),
  description: "Fast-path deploy of an inventory sync agent from a personal repo",
  code_payload: RISKY_TEMPLATES[0].code,
  pipeline: "local-shell-script",
  runner: "self-hosted-macbook",
});

const secondBypassTs = NOW - 3 * DAY - 4 * HOUR;
rows.push({
  submission_id: idFor(secondBypassTs),
  received_at: new Date(secondBypassTs).toISOString(),
  developer_name: "Tobias Krieger",
  developer_email: "tobias.krieger@dentsplysirona.com",
  team: "Digital Dentistry",
  region: "DE",
  source_tool: "github-copilot",
  model_used: "gpt-4o",
  repo: "dentsplysirona-labs/scanner-sandbox",
  branch: "main",
  commit_sha: commitFor("bypass-historic-2"),
  description: "Sandbox scanner calibration agent promoted directly from a lab repo",
  code_payload: CLEAN_TEMPLATES[1].code,
  pipeline: "ds-github-actions-prod",
  runner: "self-hosted-lab-runner",
});

const PENDING: Seeded[] = [
  {
    submission_id: idFor(NOW - 2 * HOUR),
    received_at: new Date(NOW - 2 * HOUR).toISOString(),
    developer_name: "Sofia Marchetti",
    developer_email: "sofia.marchetti@dentsplysirona.com",
    team: "Clinical Data",
    region: "US",
    source_tool: "github-copilot",
    model_used: "gpt-4o",
    repo: "dentsplysirona/clinical-data-platform",
    branch: "feature/outcomes-export",
    commit_sha: commitFor("pending-hipaa"),
    description: "Export treatment history for the outcomes analytics model",
    code_payload: RISKY_TEMPLATES[1].code,
    pipeline: "ds-azure-devops-prod",
    runner: "ds-azure-hosted-runner",
    forced_status: "pending",
  },
  {
    submission_id: idFor(NOW - 4 * HOUR),
    received_at: new Date(NOW - 4 * HOUR).toISOString(),
    developer_name: "Priya Raghavan",
    developer_email: "priya.raghavan@dentsplysirona.com",
    team: "Digital Dentistry",
    region: "US",
    source_tool: "claude-code",
    model_used: "claude-sonnet-4-5",
    repo: "dentsplysirona/digital-dentistry-agents",
    branch: "feature/supplier-enrich",
    commit_sha: commitFor("pending-egress"),
    description: "Enrich supplier records using an external data provider",
    code_payload: RISKY_TEMPLATES[2].code,
    pipeline: "ds-github-actions-prod",
    runner: "sanctioned-github-actions",
    forced_status: "pending",
  },
  {
    submission_id: idFor(NOW - 7 * HOUR),
    received_at: new Date(NOW - 7 * HOUR).toISOString(),
    developer_name: "Dana Whitfield",
    developer_email: "dana.whitfield@dentsplysirona.com",
    team: "IT-Ops",
    region: "US",
    source_tool: "3b-native",
    model_used: "claude-sonnet-4-5",
    repo: "dentsplysirona/itops-runbooks",
    branch: "feature/device-reconcile",
    commit_sha: commitFor("pending-scope"),
    description: "Bulk reconcile device registrations across regions",
    code_payload: RISKY_TEMPLATES[3].code,
    pipeline: "ds-3b-native-deploy",
    runner: "3b-managed-runner",
    forced_status: "pending",
  },
  {
    submission_id: idFor(NOW - 20 * HOUR),
    received_at: new Date(NOW - 20 * HOUR).toISOString(),
    developer_name: "Lena Hoffmann",
    developer_email: "lena.hoffmann@dentsplysirona.com",
    team: "R&D-Endodontics",
    region: "DE",
    source_tool: "claude-code",
    model_used: "claude-sonnet-4-5",
    repo: "dentsplysirona/endo-automation",
    branch: "feature/log-rotation",
    commit_sha: commitFor("pending-shell"),
    description: "Rotate log archives on the imaging file share",
    code_payload: RISKY_TEMPLATES[4].code,
    pipeline: "ds-github-actions-prod",
    runner: "sanctioned-github-actions",
    forced_status: "pending",
  },
  {
    submission_id: idFor(NOW - 26 * HOUR),
    received_at: new Date(NOW - 26 * HOUR).toISOString(),
    developer_name: "Kenji Watanabe",
    developer_email: "kenji.watanabe@dentsplysirona.com",
    team: "Digital Dentistry",
    region: "JP",
    source_tool: "github-copilot",
    model_used: "gemini-2.5-pro",
    repo: "dentsplysirona/digital-dentistry-agents",
    branch: "feature/cad-metrics",
    commit_sha: commitFor("pending-model-jp"),
    description: "Push CAD job metrics into the reliability warehouse",
    code_payload: RISKY_TEMPLATES[0].code,
    pipeline: "ds-azure-devops-prod",
    runner: "ds-azure-hosted-runner",
    forced_status: "pending",
  },
];

const REVIEWERS = [
  "Ingrid Bauer (Security Architecture)",
  "Paul Nakamura (AppSec)",
  "Claudia Reiss (Deputy CISO Office)",
];

const APPROVE_COMMENTS = [
  "Findings reviewed with the developer; secrets moved to the scoped credential store before promotion.",
  "Medium-severity findings accepted for this release; follow-up ticket GOV-{n} raised for hardening.",
  "Egress target added to the reviewed allowlist by Network Security; approved for production.",
];
const REJECT_COMMENTS = [
  "PHI leaves the HIPAA boundary — rejected. Re-submit using the Foundry-scoped model and tokenized identifiers.",
  "Hardcoded credential in the artifact. Rejected; rebuild with a named credential reference.",
  "Unsanctioned egress domain and TLS verification disabled. Rejected pending Network Security review.",
];
const CHANGES_COMMENTS = [
  "Add error handling around the outbound call and re-submit.",
  "Replace the wildcard scope with team-scoped permissions, then re-submit.",
];

const db = openDb();
db.run("DELETE FROM submissions");
db.run("DELETE FROM audit");
db.run("DELETE FROM security_events");

let counts: Record<string, number> = {};
let govTicket = 4100;

function ingest(r: Seeded) {
  const scan = scanPayload(r.code_payload);
  const modelPolicy = evaluateModelPolicy(r.team, r.region, r.model_used);
  const bypass = detectBypass(r);
  const policies_fired = [
    ...scan.findings.map((f) => f.rule_id),
    ...(modelPolicy.compliant ? [] : [modelPolicy.rule_id!]),
    ...bypass.reasons.map((b) => b.rule_id),
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

  const receivedMs = Date.parse(r.received_at);
  let reviewer: string | null = null;
  let reviewer_comment: string | null = null;
  let decided_at: string | null = null;
  let decision_seconds: number | null = null;
  let deployment_id: string | null = null;
  let deployed_at: string | null = null;

  if (r.forced_status === "pending") {
    status = "pending";
    reason = !modelPolicy.compliant
      ? `Model policy violation (${modelPolicy.rule_id}) — mandatory security review before promotion.`
      : `Policy scan risk score ${scan.risk_score} requires human review.`;
  }

  if (status === "blocked" || status === "auto-approved") {
    reviewer = "3b-gateway (automated)";
    reviewer_comment = reason;
    decision_seconds = 2 + Math.round(rand() * 40) / 10;
    decided_at = new Date(receivedMs + decision_seconds * 1000).toISOString();
  } else if (r.forced_status !== "pending") {
    const roll = rand();
    const humanSeconds = 240 + Math.floor(rand() * 5400);
    decision_seconds = humanSeconds;
    decided_at = new Date(receivedMs + humanSeconds * 1000).toISOString();
    reviewer = pick(REVIEWERS);
    if (roll < 0.6) {
      status = "approved";
      govTicket += 1;
      reviewer_comment = pick(APPROVE_COMMENTS).replace("{n}", String(govTicket));
    } else if (roll < 0.85) {
      status = "rejected";
      reviewer_comment = pick(REJECT_COMMENTS);
    } else {
      status = "changes-requested";
      reviewer_comment = pick(CHANGES_COMMENTS);
    }
  }

  if (status === "auto-approved" || status === "approved") {
    deployment_id = `DEP-${createHash("sha256").update(`${r.submission_id}:${r.commit_sha}`).digest("hex").slice(0, 8).toUpperCase()}`;
    deployed_at = new Date(Date.parse(decided_at!) + 9000).toISOString();
    status = "deployed";
  }

  const credentials = {
    note: "Credentials are referenced by name and scope only. No secret value is ever read by, logged by, or returned to step code.",
    references: [
      {
        name: `ds-${r.team.toLowerCase().replace(/[^a-z]+/g, "")}-deploy-token`,
        purpose: "Promote artifact to the team production namespace",
        scope: `space:eortiz / team:${r.team} / env:prod`,
        injected_at: "runtime",
        visible_to_code: false,
        value: "«never exposed — injected by the 3B credential proxy»",
      },
      {
        name: "ds-audit-sink-token",
        purpose: "Write immutable audit record to the governance ledger",
        scope: "space:eortiz / append-only",
        injected_at: "runtime",
        visible_to_code: false,
        value: "«never exposed — injected by the 3B credential proxy»",
      },
    ],
  };

  saveSubmission(db, {
    ...r,
    risk_score: scan.risk_score,
    scan_verdict: scan.scan_verdict,
    findings: scan.findings,
    model_policy: modelPolicy,
    bypass: { ...bypass, pipeline: r.pipeline, runner: r.runner },
    credentials,
    status,
    reviewer,
    reviewer_comment,
    decided_at,
    decision_seconds,
    deployment_id,
    deployed_at,
  });

  appendAudit(db, {
    ts: r.received_at,
    submission_id: r.submission_id,
    actor: `${r.developer_name} via ${r.source_tool}`,
    action: "submission.received",
    policies_fired,
    disposition: status === "deployed" ? "approved" : status,
    comment: reason,
    detail: {
      risk_score: scan.risk_score,
      scan_verdict: scan.scan_verdict,
      model_policy_rule: modelPolicy.rule_id,
      model_policy_compliant: modelPolicy.compliant,
      bypass_attempt: bypass.bypass_attempt,
      repo: r.repo,
      commit_sha: r.commit_sha,
    },
  });

  if (decided_at && reviewer) {
    appendAudit(db, {
      ts: decided_at,
      submission_id: r.submission_id,
      actor: reviewer,
      action: reviewer.startsWith("3b-gateway") ? `disposition.${status === "deployed" ? "auto-approved" : status}` : `review.${status === "deployed" ? "approve" : status === "rejected" ? "reject" : "request-changes"}`,
      policies_fired,
      comment: reviewer_comment ?? "",
      disposition: status === "deployed" ? "approved" : status,
      detail: { decision_seconds, human_gate: !reviewer.startsWith("3b-gateway") },
    });
  }

  if (deployment_id) {
    appendAudit(db, {
      ts: deployed_at!,
      submission_id: r.submission_id,
      actor: "3b-gateway (automated)",
      action: "deployment.promoted",
      policies_fired,
      comment: "Artifact promoted to production namespace.",
      disposition: "deployed",
      detail: { deployment_id, artifact: `${r.repo}@${r.commit_sha}`, immutable: true },
    });
  }

  if (bypass.bypass_attempt) {
    raiseSecurityEvent(db, {
      ts: r.received_at,
      submission_id: r.submission_id,
      severity: "critical",
      kind: "bypass_attempt",
      message: `Blocked ungoverned deployment from ${r.repo} (runner ${r.runner}) by ${r.developer_name}.`,
    });
  }
  if (!modelPolicy.compliant) {
    raiseSecurityEvent(db, {
      ts: r.received_at,
      submission_id: r.submission_id,
      severity: "high",
      kind: "model_policy_violation",
      message: `${r.model_used} used by ${r.team} / ${r.region} violates ${modelPolicy.rule_id}.`,
    });
  }

  counts[status] = (counts[status] ?? 0) + 1;
}

for (const r of [...rows, ...PENDING]) ingest(r);

const total = (db.query("SELECT COUNT(*) AS c FROM submissions").get() as any).c;
const auditCount = (db.query("SELECT COUNT(*) AS c FROM audit").get() as any).c;
const events = (db.query("SELECT COUNT(*) AS c FROM security_events").get() as any).c;
db.close();

console.error(
  `event=seed.completed submissions=${total} audit_records=${auditCount} security_events=${events} breakdown="${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" ")}"`,
);

process.stdout.write(JSON.stringify({ seeded: true, submissions: total, audit_records: auditCount, security_events: events, breakdown: counts }, null, 2));
