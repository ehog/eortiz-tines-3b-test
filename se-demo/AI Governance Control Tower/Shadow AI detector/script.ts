import { BASELINE, CATALOG, ENRICHMENT_MODEL, FEEDS, OBSERVATIONS } from "./feed";

const VOL = "/storage/ai_governance";
const PATH = `${VOL}/shadow.json`;
const now = new Date();
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(now.getTime() - n * 86_400_000));

type Entry = {
  domain: string;
  tool: string;
  decision: "allow" | "block" | "review";
  vendor: string;
  category: string;
  hq: string;
  risk_notes: string;
  trains_on_input: boolean;
  baa: boolean;
  risk: "critical" | "high" | "medium" | "low";
  proposed: "allow" | "block" | null;
  first_seen: string;
  last_seen: string;
  users: number;
  devices: number;
  sessions_7d: number;
  uploads_detected: boolean;
  top_teams: string[];
  feed: string;
  decided_by: string | null;
  decided_at: string | null;
};

type Change = {
  at: string;
  domain: string;
  action: "added" | "moved" | "removed" | "detected";
  from: string | null;
  to: string;
  actor: string;
  note: string;
};

type State = { generated_at: string; enrichment_model: string; runs: number; entries: Entry[]; changes: Change[] };

const enrich = (domain: string, tool: string) =>
  CATALOG[domain] ?? {
    vendor: tool,
    category: "Unclassified AI service",
    hq: "Unknown",
    risk_notes: "No vendor record found; enrichment returned nothing. Treat as unreviewed.",
    trains_on_input: true,
    baa: false,
  };

function riskOf(e: Pick<Entry, "hq" | "trains_on_input" | "baa" | "uploads_detected" | "users">) {
  let s = 0;
  if (e.hq === "China" || e.hq === "Unknown") s += 3;
  if (e.trains_on_input) s += 2;
  if (!e.baa) s += 1;
  if (e.uploads_detected) s += 2;
  if (e.users > 50) s += 1;
  return s >= 6 ? "critical" : s >= 4 ? "high" : s >= 2 ? "medium" : "low";
}

let state: State;
if (await Bun.file(PATH).exists()) {
  state = await Bun.file(PATH).json();
} else {
  state = { generated_at: iso(now), enrichment_model: ENRICHMENT_MODEL, runs: 0, entries: [], changes: [] };
  for (const b of BASELINE) {
    const obs = OBSERVATIONS.find((o) => o.domain === b.domain);
    const meta = enrich(b.domain, obs?.tool ?? b.domain);
    state.entries.push({
      domain: b.domain,
      tool: obs?.tool ?? b.domain,
      decision: b.decision,
      ...meta,
      risk: riskOf({ ...meta, uploads_detected: obs?.uploads_detected ?? false, users: obs?.users ?? 0 }),
      proposed: null,
      first_seen: daysAgo(obs?.first_seen_days_ago ?? b.days_ago),
      last_seen: obs ? iso(now) : daysAgo(b.days_ago),
      users: obs?.users ?? 0,
      devices: obs?.devices ?? 0,
      sessions_7d: obs?.sessions_7d ?? 0,
      uploads_detected: obs?.uploads_detected ?? false,
      top_teams: obs?.top_teams ?? [],
      feed: obs?.feed ?? "policy import",
      decided_by: b.actor,
      decided_at: daysAgo(b.days_ago),
    });
    state.changes.push({
      at: daysAgo(b.days_ago),
      domain: b.domain,
      action: "added",
      from: null,
      to: b.decision,
      actor: b.actor,
      note: b.note,
    });
  }
}

const byDomain = new Map(state.entries.map((e) => [e.domain, e]));
const newlySeen: Entry[] = [];

for (const o of OBSERVATIONS) {
  const existing = byDomain.get(o.domain);
  const meta = enrich(o.domain, o.tool);
  const risk = riskOf({ ...meta, uploads_detected: o.uploads_detected, users: o.users });

  if (existing) {
    Object.assign(existing, {
      users: o.users,
      devices: o.devices,
      sessions_7d: o.sessions_7d,
      uploads_detected: o.uploads_detected,
      top_teams: o.top_teams,
      last_seen: iso(now),
      risk,
    });
    continue;
  }

  const proposed: "allow" | "block" = risk === "critical" || risk === "high" ? "block" : "allow";
  const entry: Entry = {
    domain: o.domain,
    tool: o.tool,
    decision: "review",
    ...meta,
    risk,
    proposed,
    first_seen: daysAgo(o.first_seen_days_ago),
    last_seen: iso(now),
    users: o.users,
    devices: o.devices,
    sessions_7d: o.sessions_7d,
    uploads_detected: o.uploads_detected,
    top_teams: o.top_teams,
    feed: o.feed,
    decided_by: null,
    decided_at: null,
  };
  state.entries.push(entry);
  byDomain.set(o.domain, entry);
  newlySeen.push(entry);
  state.changes.push({
    at: iso(now),
    domain: o.domain,
    action: "detected",
    from: null,
    to: "review",
    actor: `${o.feed} → Shadow AI detector (${ENRICHMENT_MODEL})`,
    note: `${o.users} users on ${o.devices} devices; enrichment risk ${risk}; proposed ${proposed}.`,
  });
}

// A tool nobody has touched in 60 days no longer needs to sit on the allow list.
for (const e of state.entries) {
  const stale = now.getTime() - new Date(e.last_seen).getTime() > 60 * 86_400_000;
  if (stale && e.decision === "allow") {
    state.changes.push({
      at: iso(now),
      domain: e.domain,
      action: "removed",
      from: "allow",
      to: "retired",
      actor: "Shadow AI detector",
      note: "No observed usage in 60 days; entitlement retired to shrink the surface.",
    });
    e.decision = "review";
    e.proposed = "block";
  }
}

state.generated_at = iso(now);
state.enrichment_model = ENRICHMENT_MODEL;
state.runs += 1;
state.changes.sort((a, b) => b.at.localeCompare(a.at));

await Bun.write(PATH, JSON.stringify({ ...state, feeds: FEEDS.map((f) => ({ id: f.id, label: f.label, query: f.query })) }, null, 2));

console.error(`shadow AI: ${state.entries.length} tracked, ${newlySeen.length} newly detected this run`);
for (const e of newlySeen) console.error(`  ${e.risk.padEnd(8)} ${e.domain} (${e.vendor}, ${e.hq}) → propose ${e.proposed}`);
console.log(JSON.stringify({ generated_at: state.generated_at, tracked: state.entries.length, newly_detected: newlySeen.length }));
