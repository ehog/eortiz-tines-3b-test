import { FAST_TRACK_STAGES, STAGES, type Stage } from "./stages";

const VOL = "/storage/ai_governance";
const now = new Date();
const iso = (d: Date) => d.toISOString();
const back = (mins: number) => iso(new Date(now.getTime() - mins * 60_000));

const inventory = await Bun.file(`${VOL}/inventory.json`).json();
const spillage = await Bun.file(`${VOL}/spillage.json`).json();
const shadow = (await Bun.file(`${VOL}/shadow.json`).exists()) ? await Bun.file(`${VOL}/shadow.json`).json() : { entries: [] };

type Item = {
  id: string;
  subject: string;
  kind: "build" | "shadow tool" | "spillage remediation";
  team: string;
  owner: string | null;
  risk: "critical" | "high" | "medium" | "low";
  classification: string | null;
  lane: "standard" | "fast-track";
  stage: Stage;
  stage_entered_at: string;
  opened_at: string;
  days_in_use: number;
  rationale: string;
  next_action: string;
  outcome: "in flight" | "implemented" | "killed";
};

type Audit = {
  seq: number;
  at: string;
  actor: string;
  action: string;
  item_id: string;
  field: string;
  prior_value: string | null;
  new_value: string;
  note: string;
};

const prior: { items: Item[] } = (await Bun.file(`${VOL}/pipeline.json`).exists())
  ? await Bun.file(`${VOL}/pipeline.json`).json()
  : { items: [] };
const auditLog: Audit[] = (await Bun.file(`${VOL}/audit.json`).exists())
  ? (await Bun.file(`${VOL}/audit.json`).json()).records
  : [];
const priorById = new Map(prior.items.map((i) => [i.id, i]));

let seq = auditLog.length ? auditLog[auditLog.length - 1].seq : 0;
const record = (r: Omit<Audit, "seq">) => {
  auditLog.push({ seq: ++seq, ...r });
};

const riskBand = (score: number) => (score >= 75 ? "critical" : score >= 55 ? "high" : score >= 35 ? "medium" : "low") as Item["risk"];
const daysSince = (isoStr: string) => Math.round((now.getTime() - new Date(isoStr).getTime()) / 86_400_000);

const candidates: Item[] = [];

for (const b of inventory.builds) {
  const findings = spillage.findings.filter((f: any) => f.build_id === b.id);
  const risk = riskBand(b.risk_score);
  const inUse = daysSince(b.created);
  const flagged = b.status !== "healthy" || b.unowned || findings.length > 0 || risk === "critical" || risk === "high";
  if (!flagged) continue;

  const fastTrack = inUse < 7 && (risk === "low" || risk === "medium") && findings.length === 0;
  const lanes = fastTrack ? FAST_TRACK_STAGES : STAGES;
  // Position in the chain is driven by how long the item has been in review and its risk.
  const progress = Math.min(lanes.length - 1, Math.floor(inUse / 30) + (risk === "critical" ? 0 : 1));
  const stage = lanes[Math.min(progress, lanes.length - 1)] as Stage;

  candidates.push({
    id: `build:${b.id}`,
    subject: b.name,
    kind: findings.length ? "spillage remediation" : "build",
    team: b.team,
    owner: b.owner,
    risk,
    classification: b.classification,
    lane: fastTrack ? "fast-track" : "standard",
    stage,
    stage_entered_at: iso(new Date(now.getTime() - (inUse % 14) * 86_400_000)),
    opened_at: b.created,
    days_in_use: inUse,
    rationale: findings.length
      ? `${findings.length} open spillage finding(s); highest severity ${findings[0].severity}.`
      : b.unowned
        ? "No named owner; accountability gap."
        : `Status ${b.status} with risk score ${b.risk_score}.`,
    next_action:
      stage === "Implement / Kill"
        ? "Decision required: implement with controls, or kill and revoke credentials."
        : `Awaiting ${stage} sign-off.`,
    outcome: "in flight",
  });
}

for (const e of shadow.entries ?? []) {
  if (e.decision !== "review") continue;
  const inUse = daysSince(e.first_seen);
  const fastTrack = inUse < 7 && (e.risk === "low" || e.risk === "medium");
  candidates.push({
    id: `tool:${e.domain}`,
    subject: `${e.tool} (${e.domain})`,
    kind: "shadow tool",
    team: e.top_teams[0] ?? "Unassigned",
    owner: null,
    risk: e.risk,
    classification: null,
    lane: fastTrack ? "fast-track" : "standard",
    stage: fastTrack ? "Security / IT review" : "AI Working Group",
    stage_entered_at: iso(now),
    opened_at: e.first_seen,
    days_in_use: inUse,
    rationale: `Detected by ${e.feed}: ${e.users} users. ${e.risk_notes}`,
    next_action: `Proposed ${e.proposed}; confirm or override.`,
    outcome: "in flight",
  });
}

const items = candidates.map((c) => {
  const before = priorById.get(c.id);
  if (!before) {
    record({
      at: back(candidates.indexOf(c)),
      actor: "Governance approval routing",
      action: "item opened",
      item_id: c.id,
      field: "stage",
      prior_value: null,
      new_value: `${c.lane} · ${c.stage}`,
      note: c.rationale,
    });
    return c;
  }
  if (before.stage !== c.stage || before.lane !== c.lane) {
    record({
      at: iso(now),
      actor: "Governance approval routing",
      action: "stage changed",
      item_id: c.id,
      field: before.lane !== c.lane ? "lane" : "stage",
      prior_value: `${before.lane} · ${before.stage}`,
      new_value: `${c.lane} · ${c.stage}`,
      note: "Recomputed from current risk and time in use.",
    });
  }
  // Human decisions recorded elsewhere are authoritative and never recomputed away.
  return before.outcome === "in flight" ? { ...c, stage: before.stage, lane: before.lane, stage_entered_at: before.stage_entered_at } : before;
});

await Bun.write(
  `${VOL}/pipeline.json`,
  JSON.stringify({ generated_at: iso(now), stages: STAGES, fast_track_stages: FAST_TRACK_STAGES, items }, null, 2),
);
await Bun.write(`${VOL}/audit.json`, JSON.stringify({ generated_at: iso(now), append_only: true, records: auditLog }, null, 2));

console.error(`routed ${items.length} items (${items.filter((i) => i.lane === "fast-track").length} fast-track); audit records: ${auditLog.length}`);
console.log(JSON.stringify({ generated_at: iso(now), item_count: items.length, audit_records: auditLog.length }));
