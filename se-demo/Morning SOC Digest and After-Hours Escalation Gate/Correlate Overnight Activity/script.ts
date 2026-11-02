import { normalizeAlert, slug, type Alert, type CriticalAsset, type Severity } from "./soclib";

type CollectOutput = {
  trigger: string;
  window: { start: string; end: string; lookbackHours: number; etLabel: string };
  config: { pageThreshold: number; suppressBelowScore: number; model: string; delivery: Record<string, string> };
  assets: CriticalAsset[];
  sources: Record<string, Array<Record<string, unknown>>>;
  deferred: Array<{ alert: Alert; score: number; reason: string; queuedAt: string }>;
  gateDecisions: Array<{ alert: Alert; decision: string; score: number; reason: string; decidedAt: string }>;
};

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("No collection payload on stdin.");
  process.exit(1);
}
const input = JSON.parse(raw) as CollectOutput;

const SEVERITY_RANK: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const CLOSED_STATES = new Set(["closed", "resolved", "auto-quarantined", "auto-mitigated", "auto-closed"]);

type Item = {
  alert: Alert;
  sourceState: string;
  closed: boolean;
  closeReason: string | null;
  gate: { decision: string; score: number; reason: string } | null;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
};

const items: Item[] = [];

for (const [source, records] of Object.entries(input.sources)) {
  for (const record of records) {
    const timestamp = String(
      record.createdAt ?? record.alertCreationTime ?? record.sys_created_on ?? record.messageTime ?? record.time ?? input.window.end,
    );
    const alert = normalizeAlert({ ...record, source }, timestamp, slug(String(record.id ?? timestamp)));
    const state = String(record.status ?? record.state ?? "open");
    const closed = CLOSED_STATES.has(state.toLowerCase());
    items.push({
      alert,
      sourceState: state,
      closed,
      closeReason: closed
        ? String(record.classification ?? record.determination ?? record.close_notes ?? `${state} at source`)
        : null,
      gate: null,
      occurrences: 1,
      firstSeen: timestamp,
      lastSeen: timestamp,
    });
  }
}

for (const d of input.deferred) {
  items.push({
    alert: d.alert,
    sourceState: "deferred-by-gate",
    closed: false,
    closeReason: null,
    gate: { decision: "deferred", score: d.score, reason: d.reason },
    occurrences: 1,
    firstSeen: d.queuedAt,
    lastSeen: d.queuedAt,
  });
}

for (const d of input.gateDecisions) {
  if (d.decision === "page") {
    // Overnight pages carry into the digest so the day shift picks up what the on-call analyst handled.
    items.push({
      alert: d.alert,
      sourceState: "paged-by-gate",
      closed: false,
      closeReason: null,
      gate: { decision: "page", score: d.score, reason: d.reason },
      occurrences: 1,
      firstSeen: d.decidedAt,
      lastSeen: d.decidedAt,
    });
    continue;
  }
  if (d.decision !== "suppressed") continue;
  items.push({
    alert: d.alert,
    sourceState: "suppressed-by-gate",
    closed: true,
    closeReason: d.reason,
    gate: { decision: "suppressed", score: d.score, reason: d.reason },
    occurrences: 1,
    firstSeen: d.decidedAt,
    lastSeen: d.decidedAt,
  });
}

// Deduplicate: same source, same detection, same subject collapses into one item with an occurrence count.
const deduped = new Map<string, Item>();
for (const item of items) {
  const a = item.alert;
  const fingerprint = [a.source, slug(a.title), a.host ?? "-", a.user ?? "-", a.indicator ?? "-"].join("|");
  const existing = deduped.get(fingerprint);
  if (!existing) {
    deduped.set(fingerprint, { ...item });
    continue;
  }
  existing.occurrences += 1;
  existing.firstSeen = item.firstSeen < existing.firstSeen ? item.firstSeen : existing.firstSeen;
  existing.lastSeen = item.lastSeen > existing.lastSeen ? item.lastSeen : existing.lastSeen;
  existing.closed = existing.closed && item.closed;
  existing.gate = existing.gate ?? item.gate;
  if (SEVERITY_RANK[item.alert.severity] > SEVERITY_RANK[existing.alert.severity]) existing.alert = item.alert;
}
const unique = [...deduped.values()];
const duplicatesRemoved = items.length - unique.length;

// Correlate: union-find over shared user, host and indicator keys.
const parent = new Map<number, number>();
const find = (i: number): number => {
  let root = i;
  while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
  parent.set(i, root);
  return root;
};
const union = (a: number, b: number) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent.set(rb, ra);
};
unique.forEach((_, i) => parent.set(i, i));

const keyIndex = new Map<string, number>();
unique.forEach((item, i) => {
  const keys = [
    item.alert.user ? `user:${item.alert.user.toLowerCase()}` : null,
    item.alert.host ? `host:${item.alert.host.toLowerCase()}` : null,
    item.alert.indicator ? `ioc:${item.alert.indicator.toLowerCase()}` : null,
  ].filter((k): k is string => k !== null);
  for (const key of keys) {
    const seen = keyIndex.get(key);
    if (seen === undefined) keyIndex.set(key, i);
    else union(seen, i);
  }
});

const clusters = new Map<number, number[]>();
unique.forEach((_, i) => {
  const root = find(i);
  clusters.set(root, [...(clusters.get(root) ?? []), i]);
});

const assetFor = (host?: string) =>
  host ? (input.assets.find((a) => a.hostname.toLowerCase() === host.toLowerCase()) ?? null) : null;

type Entity = {
  id: string;
  subjects: { users: string[]; hosts: string[]; indicators: string[] };
  criticalAssets: Array<{ hostname: string; tier: string; owner: string; businessService: string }>;
  sources: string[];
  sourceCounts: Record<string, number>;
  maxSeverity: Severity;
  confidences: string[];
  gate: { pagedOrDeferred: string[]; maxScore: number | null };
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  priorityScore: number;
  titles: string[];
  members: Array<{
    source: string;
    title: string;
    severity: Severity;
    confidence: string;
    state: string;
    occurrences: number;
    at: string;
    user?: string;
    host?: string;
    indicator?: string;
    gateDecision?: string;
    gateScore?: number;
  }>;
};

const openEntities: Entity[] = [];
const closedItems: Item[] = [];

for (const indices of clusters.values()) {
  const members = indices.map((i) => unique[i]);
  const open = members.filter((m) => !m.closed);
  closedItems.push(...members.filter((m) => m.closed));
  if (open.length === 0) continue;

  const users = [...new Set(open.map((m) => m.alert.user).filter((v): v is string => !!v))];
  const hosts = [...new Set(open.map((m) => m.alert.host).filter((v): v is string => !!v))];
  const indicators = [...new Set(open.map((m) => m.alert.indicator).filter((v): v is string => !!v))];
  const sourceCounts: Record<string, number> = {};
  for (const m of open) sourceCounts[m.alert.source] = (sourceCounts[m.alert.source] ?? 0) + m.occurrences;
  const maxSeverity = open.reduce<Severity>(
    (acc, m) => (SEVERITY_RANK[m.alert.severity] > SEVERITY_RANK[acc] ? m.alert.severity : acc),
    "info",
  );
  const criticalAssets = hosts
    .map((h) => assetFor(h))
    .filter((a): a is CriticalAsset => a !== null)
    .map((a) => ({ hostname: a.hostname, tier: a.tier, owner: a.owner, businessService: a.businessService }));
  const gateScores = open.map((m) => m.gate?.score).filter((s): s is number => typeof s === "number");
  const tierBoost = criticalAssets.reduce((best, a) => Math.max(best, { tier0: 30, tier1: 22, tier2: 12, tier3: 5 }[a.tier] ?? 0), 0);
  const priorityScore =
    SEVERITY_RANK[maxSeverity] * 12 +
    tierBoost +
    Object.keys(sourceCounts).length * 8 +
    (gateScores.length ? Math.max(...gateScores) / 5 : 0) +
    open.reduce((sum, m) => sum + Math.min(m.occurrences, 5), 0);

  openEntities.push({
    id: `ent-${slug(hosts[0] ?? users[0] ?? indicators[0] ?? "unmapped")}-${indices[0]}`,
    subjects: { users, hosts, indicators },
    criticalAssets,
    sources: Object.keys(sourceCounts).sort(),
    sourceCounts,
    maxSeverity,
    confidences: [...new Set(open.map((m) => m.alert.confidence))],
    gate: {
      pagedOrDeferred: [...new Set(open.map((m) => m.gate?.decision).filter((v): v is string => !!v))],
      maxScore: gateScores.length ? Math.max(...gateScores) : null,
    },
    firstSeen: open.reduce((min, m) => (m.firstSeen < min ? m.firstSeen : min), open[0].firstSeen),
    lastSeen: open.reduce((max, m) => (m.lastSeen > max ? m.lastSeen : max), open[0].lastSeen),
    occurrences: open.reduce((sum, m) => sum + m.occurrences, 0),
    priorityScore: Math.round(priorityScore * 10) / 10,
    titles: [...new Set(open.map((m) => m.alert.title))],
    members: open.map((m) => ({
      source: m.alert.source,
      title: m.alert.title,
      severity: m.alert.severity,
      confidence: m.alert.confidence,
      state: m.sourceState,
      occurrences: m.occurrences,
      at: m.lastSeen,
      user: m.alert.user,
      host: m.alert.host,
      indicator: m.alert.indicator,
      gateDecision: m.gate?.decision,
      gateScore: m.gate?.score,
    })),
  });
}

openEntities.sort((a, b) => b.priorityScore - a.priorityScore || a.firstSeen.localeCompare(b.firstSeen));

const bySource: Record<string, { total: number; open: number; closedOrSuppressed: number }> = {};
for (const item of unique) {
  const s = item.alert.source;
  bySource[s] = bySource[s] ?? { total: 0, open: 0, closedOrSuppressed: 0 };
  bySource[s].total += item.occurrences;
  if (item.closed) bySource[s].closedOrSuppressed += item.occurrences;
  else bySource[s].open += item.occurrences;
}

const output = {
  window: input.window,
  trigger: input.trigger,
  config: input.config,
  stats: {
    rawRecords: items.length,
    uniqueItems: unique.length,
    duplicatesRemoved,
    correlatedEntities: openEntities.length,
    multiSourceEntities: openEntities.filter((e) => e.sources.length > 1).length,
    closedOrSuppressed: closedItems.reduce((sum, i) => sum + i.occurrences, 0),
    deferredFromGate: input.deferred.length,
    pagedOvernight: input.gateDecisions.filter((d) => d.decision === "page").length,
  },
  bySource,
  entities: openEntities,
  closedOrSuppressed: closedItems.map((i) => ({
    source: i.alert.source,
    title: i.alert.title,
    severity: i.alert.severity,
    state: i.sourceState,
    reason: i.closeReason,
    occurrences: i.occurrences,
    host: i.alert.host,
    user: i.alert.user,
    gateDecision: i.gate?.decision ?? null,
    gateScore: i.gate?.score ?? null,
  })),
};

console.error(
  `Normalized ${items.length} records → ${unique.length} unique (${duplicatesRemoved} duplicates) → ` +
    `${openEntities.length} correlated entities (${output.stats.multiSourceEntities} multi-source), ` +
    `${output.stats.closedOrSuppressed} auto-closed or suppressed.`,
);

console.log(JSON.stringify(output));
