import { mkdir } from "node:fs/promises";
import { collect, type Raw } from "./sources";
import { MODEL, SOURCES } from "./config";

const VOL = "/storage/ai_governance";
const now = new Date();
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(repo\)/g, "repo")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const APPROVED_EGRESS = new Set([
  "veevavault.com",
  "graph.microsoft.com",
  "realchemistry.sharepoint.com",
  "realchemistry.atlassian.net",
  "realchemistry.snowflakecomputing.com",
  "realchemistry.bynder.com",
  "s3.amazonaws.com",
  "slack.com",
  "api.smartsheet.com",
  "api.figma.com",
  "slides.googleapis.com",
  "api.fda.gov",
  "data.cms.gov",
  "eutils.ncbi.nlm.nih.gov",
  "clinicaltrials.gov",
  "api.openai.com",
  "api.x.com",
  "api.hubapi.com",
  "workday.com",
  "displayvideo.googleapis.com",
  "api.sprinklr.com",
  "graph.instagram.com",
  "netsuite.com",
  "api.datadoghq.com",
  "bedrock-runtime.us-east-1.amazonaws.com",
  "api.airtable.com",
  "internal",
]);

function risk(r: Raw, unapproved: string[]) {
  let score = 0;
  score += { public: 0, internal: 10, PII: 28, PHI: 40 }[r.classification];
  score += { healthy: 0, warning: 14, blocked: 24 }[r.status];
  if (!r.owner) score += 18;
  if (!r.reviewed_by) score += 10;
  score += unapproved.length * 9;
  score += r.ai_written_pct > 90 ? 8 : 0;
  score += r.credentials.length > 2 ? 5 : 0;
  return Math.min(100, score);
}

const records = (await collect()).map((r: Raw) => {
  const unapproved = r.egress.filter((d) => !APPROVED_EGRESS.has(d));
  return {
    id: slug(r.name),
    name: r.name,
    type: r.type,
    team: r.team,
    owner: r.owner,
    unowned: r.owner === null,
    source: r.source,
    model: r.model,
    status: r.status,
    classification: r.classification,
    credentials: r.credentials,
    hours_saved_month: r.hours_saved_month,
    created: iso(daysAgo(r.age_days)),
    last_run: r.last_run_hours_ago === null ? null : iso(hoursAgo(r.last_run_hours_ago)),
    runs_30d: r.runs_30d,
    failures_30d: r.failures_30d,
    egress: r.egress,
    unapproved_egress: unapproved,
    provenance: {
      ai_written_pct: r.ai_written_pct,
      human_reviewer: r.reviewed_by,
      generator_model: r.model,
    },
    signals: { logs: r.logs, io: r.io },
    risk_score: risk(r, unapproved),
    collected_at: iso(now),
  };
});

const inventory = {
  generated_at: iso(now),
  normalizer_model: MODEL,
  sources: SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    endpoint: s.endpoint,
    mode: s.mode,
    records: records.filter((r) => r.source === s.label).length,
    // Coverage is reported, not assumed — the UI must not imply a complete picture.
    coverage_pct: { "3b": 100, "claude-code": 100, replit: 74, "github-security": 68 }[s.id] ?? 100,
    coverage_note:
      s.id === "replit"
        ? "Only projects under the org SSO tenant are visible; personal accounts are not enumerable."
        : s.id === "github-security"
          ? "Code scanning is enabled on 68% of repos; the rest report no findings because scanning is off, not because they are clean."
          : "Full enumeration.",
  })),
  builds: records,
};

await mkdir(VOL, { recursive: true });
await Bun.write(`${VOL}/inventory.json`, JSON.stringify(inventory, null, 2));

console.error(
  `collected ${records.length} builds across ${SOURCES.length} sources; ` +
    `${records.filter((r) => r.unowned).length} unowned`,
);
console.log(JSON.stringify({ generated_at: inventory.generated_at, build_count: records.length }));
