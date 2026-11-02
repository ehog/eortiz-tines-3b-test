import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";

export const VOLUME_DIR = "/storage/soc_state";
export const DB_PATH = `${VOLUME_DIR}/soc.db`;

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "confirmed" | "high" | "medium" | "low";
export type BusinessImpact = "revenue_impacting" | "customer_data" | "internal_only" | "none";
export type AssetTier = "tier0" | "tier1" | "tier2" | "tier3";
export type ClockMode = "real" | "after_hours" | "business_hours";
export type Decision = "page" | "deferred" | "suppressed" | "bypass_business_hours";

export type Alert = {
  id: string;
  source: string;
  externalId?: string;
  receivedAt: string;
  title: string;
  description?: string;
  severity: Severity;
  confidence: Confidence;
  user?: string;
  host?: string;
  indicator?: string;
  businessImpact: BusinessImpact;
  tags?: string[];
  raw?: unknown;
};

export type GateConfig = {
  pageThreshold: number;
  suppressBelowScore: number;
  weights: { severity: number; confidence: number; assetCriticality: number; businessImpact: number };
  afterHours: { startHour: number; endHour: number; weekendsAlwaysAfterHours: boolean };
  severityScores: Record<Severity, number>;
  confidenceScores: Record<Confidence, number>;
  businessImpactScores: Record<BusinessImpact, number>;
  assetTierScores: Record<AssetTier | "unknown", number>;
  delivery: { slackChannel: string; emailTo: string; onCallName: string; onCallEmail: string; onCallPhone: string };
  digest: { lookbackHours: number; model: string };
  notifications: { digestEmail: boolean; digestSlack: boolean; pageSlack: boolean };
};

export const TIMEZONE = "America/New_York";

export const DEFAULT_CONFIG: GateConfig = {
  pageThreshold: 65,
  suppressBelowScore: 30,
  weights: { severity: 0.4, confidence: 0.2, assetCriticality: 0.25, businessImpact: 0.15 },
  afterHours: { startHour: 19, endHour: 7, weekendsAlwaysAfterHours: true },
  severityScores: { critical: 100, high: 80, medium: 50, low: 25, info: 10 },
  confidenceScores: { confirmed: 100, high: 85, medium: 60, low: 30 },
  businessImpactScores: { revenue_impacting: 100, customer_data: 85, internal_only: 45, none: 15 },
  assetTierScores: { tier0: 100, tier1: 80, tier2: 55, tier3: 30, unknown: 40 },
  delivery: {
    slackChannel: "C0A8P2B0Y04",
    emailTo: "eortiz@tines.io",
    onCallName: "Tier 2 On-Call",
    onCallEmail: "eortiz@tines.io",
    onCallPhone: "+1-602-555-0142",
  },
  digest: { lookbackHours: 14, model: "claude-sonnet-4-6" },
  notifications: { digestEmail: true, digestSlack: true, pageSlack: true },
};

export type CriticalAsset = {
  hostname: string;
  tier: AssetTier;
  owner: string;
  businessService: string;
  businessImpact: BusinessImpact;
  notes: string;
};

/** Mock ServiceNow CMDB contents, seeded on first write. */
export const SEED_ASSETS: CriticalAsset[] = [
  { hostname: "pay-db-01", tier: "tier0", owner: "Payments Platform", businessService: "Card authorization", businessImpact: "revenue_impacting", notes: "PCI zone, primary auth database" },
  { hostname: "pay-app-02", tier: "tier0", owner: "Payments Platform", businessService: "Card authorization", businessImpact: "revenue_impacting", notes: "PCI zone, checkout API" },
  { hostname: "ehr-prod-03", tier: "tier0", owner: "Clinical Systems", businessService: "Electronic health record", businessImpact: "customer_data", notes: "PHI, 24x7 clinical use" },
  { hostname: "dc-core-01", tier: "tier1", owner: "Identity Engineering", businessService: "Active Directory", businessImpact: "internal_only", notes: "Forest root domain controller" },
  { hostname: "vpn-gw-01", tier: "tier1", owner: "Network Engineering", businessService: "Remote access", businessImpact: "internal_only", notes: "Primary remote access gateway" },
  { hostname: "hr-files-04", tier: "tier2", owner: "People Operations", businessService: "HR document store", businessImpact: "customer_data", notes: "Employee records" },
  { hostname: "build-agent-11", tier: "tier2", owner: "Developer Experience", businessService: "CI/CD", businessImpact: "internal_only", notes: "Shared build agent" },
  { hostname: "kiosk-lobby-07", tier: "tier3", owner: "Facilities", businessService: "Visitor kiosk", businessImpact: "none", notes: "Public lobby kiosk" },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_clock (id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS critical_assets (
  hostname TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  owner TEXT NOT NULL,
  business_service TEXT NOT NULL,
  business_impact TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  received_at TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence TEXT NOT NULL,
  user_name TEXT,
  host TEXT,
  indicator TEXT,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gate_decisions (
  alert_id TEXT PRIMARY KEY,
  decided_at TEXT NOT NULL,
  decision TEXT NOT NULL,
  score REAL NOT NULL,
  threshold REAL NOT NULL,
  after_hours INTEGER NOT NULL,
  clock_mode TEXT NOT NULL,
  reason TEXT NOT NULL,
  breakdown TEXT NOT NULL,
  replayed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deferred_queue (
  alert_id TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL,
  score REAL NOT NULL,
  reason TEXT NOT NULL,
  digested_at TEXT
);
CREATE TABLE IF NOT EXISTS paged_events (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  on_call TEXT NOT NULL,
  score REAL NOT NULL,
  payload TEXT NOT NULL,
  slack_channel TEXT,
  slack_ts TEXT,
  slack_error TEXT,
  acked_at TEXT,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  window_start TEXT,
  window_end TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  markdown TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  slack_text TEXT NOT NULL DEFAULT '',
  json TEXT NOT NULL DEFAULT '{}',
  email_status TEXT,
  slack_status TEXT
);
CREATE TABLE IF NOT EXISTS timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}'
);
`;

export function openWritable(): Database {
  mkdirSync(VOLUME_DIR, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  seed(db);
  return db;
}

export function openReadonly(): Database | null {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

export function seed(db: Database): void {
  const cfg = db.query<{ json: string }, []>("SELECT json FROM config WHERE id = 1").get();
  if (!cfg) {
    db.query("INSERT INTO config (id, json) VALUES (1, ?)").run(JSON.stringify(DEFAULT_CONFIG));
  }
  const clock = db.query("SELECT mode FROM demo_clock WHERE id = 1").get();
  if (!clock) {
    db.query("INSERT INTO demo_clock (id, mode, updated_at) VALUES (1, 'real', ?)").run(new Date().toISOString());
  }
  const assetCount = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM critical_assets").get();
  if (!assetCount || assetCount.n === 0) {
    const insert = db.query(
      "INSERT INTO critical_assets (hostname, tier, owner, business_service, business_impact, notes) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const a of SEED_ASSETS) {
      insert.run(a.hostname, a.tier, a.owner, a.businessService, a.businessImpact, a.notes);
    }
  }
}

export function getConfig(db: Database): GateConfig {
  const row = db.query<{ json: string }, []>("SELECT json FROM config WHERE id = 1").get();
  if (!row) return structuredClone(DEFAULT_CONFIG);
  return mergeConfig(JSON.parse(row.json));
}

export function mergeConfig(partial: unknown): GateConfig {
  const p = (partial ?? {}) as Record<string, any>;
  const d = DEFAULT_CONFIG;
  return {
    pageThreshold: num(p.pageThreshold, d.pageThreshold, 0, 100),
    suppressBelowScore: num(p.suppressBelowScore, d.suppressBelowScore, 0, 100),
    weights: {
      severity: num(p.weights?.severity, d.weights.severity, 0, 1),
      confidence: num(p.weights?.confidence, d.weights.confidence, 0, 1),
      assetCriticality: num(p.weights?.assetCriticality, d.weights.assetCriticality, 0, 1),
      businessImpact: num(p.weights?.businessImpact, d.weights.businessImpact, 0, 1),
    },
    afterHours: {
      startHour: Math.round(num(p.afterHours?.startHour, d.afterHours.startHour, 0, 23)),
      endHour: Math.round(num(p.afterHours?.endHour, d.afterHours.endHour, 0, 23)),
      weekendsAlwaysAfterHours: p.afterHours?.weekendsAlwaysAfterHours ?? d.afterHours.weekendsAlwaysAfterHours,
    },
    severityScores: { ...d.severityScores, ...clampMap(p.severityScores) },
    confidenceScores: { ...d.confidenceScores, ...clampMap(p.confidenceScores) },
    businessImpactScores: { ...d.businessImpactScores, ...clampMap(p.businessImpactScores) },
    assetTierScores: { ...d.assetTierScores, ...clampMap(p.assetTierScores) },
    delivery: {
      slackChannel: str(p.delivery?.slackChannel, d.delivery.slackChannel),
      emailTo: str(p.delivery?.emailTo, d.delivery.emailTo),
      onCallName: str(p.delivery?.onCallName, d.delivery.onCallName),
      onCallEmail: str(p.delivery?.onCallEmail, d.delivery.onCallEmail),
      onCallPhone: str(p.delivery?.onCallPhone, d.delivery.onCallPhone),
    },
    digest: {
      lookbackHours: Math.round(num(p.digest?.lookbackHours, d.digest.lookbackHours, 1, 48)),
      model: str(p.digest?.model, d.digest.model),
    },
    notifications: {
      digestEmail: bool(p.notifications?.digestEmail, d.notifications.digestEmail),
      digestSlack: bool(p.notifications?.digestSlack, d.notifications.digestSlack),
      pageSlack: bool(p.notifications?.pageSlack, d.notifications.pageSlack),
    },
  };
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

function clampMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") {
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(raw);
      if (Number.isFinite(n)) out[k] = Math.min(100, Math.max(0, n));
    }
  }
  return out;
}

export function saveConfig(db: Database, partial: unknown): GateConfig {
  const merged = mergeConfig(partial);
  db.query("UPDATE config SET json = ? WHERE id = 1").run(JSON.stringify(merged));
  return merged;
}

export function getClockMode(db: Database): ClockMode {
  const row = db.query<{ mode: string }, []>("SELECT mode FROM demo_clock WHERE id = 1").get();
  const mode = row?.mode;
  return mode === "after_hours" || mode === "business_hours" ? mode : "real";
}

export function listAssets(db: Database): CriticalAsset[] {
  return db
    .query<
      { hostname: string; tier: string; owner: string; business_service: string; business_impact: string; notes: string },
      []
    >("SELECT * FROM critical_assets ORDER BY tier, hostname")
    .all()
    .map((r) => ({
      hostname: r.hostname,
      tier: r.tier as AssetTier,
      owner: r.owner,
      businessService: r.business_service,
      businessImpact: r.business_impact as BusinessImpact,
      notes: r.notes,
    }));
}

/** Time-of-day helpers evaluated in America/New_York regardless of host timezone. */
export function etParts(at: Date): { hour: number; minute: number; weekday: number; label: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZoneName: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    weekday: Math.max(0, weekdays.indexOf(String(parts.weekday))),
    label: `${parts.weekday} ${parts.month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`,
  };
}

export function isAfterHours(at: Date, config: GateConfig, clockMode: ClockMode): { afterHours: boolean; basis: string } {
  if (clockMode === "after_hours") return { afterHours: true, basis: "demo clock forced to after-hours" };
  if (clockMode === "business_hours") return { afterHours: false, basis: "demo clock forced to business hours" };
  const { hour, minute, weekday, label } = etParts(at);
  const { startHour, endHour, weekendsAlwaysAfterHours } = config.afterHours;
  if (weekendsAlwaysAfterHours && (weekday === 0 || weekday === 6)) {
    return { afterHours: true, basis: `weekend (${label})` };
  }
  const afterHours = hour >= startHour || hour < endHour;
  const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`;
  return {
    afterHours,
    basis: afterHours
      ? `${hhmm} is outside the ${pad(endHour)}:00–${pad(startHour)}:00 ET coverage window`
      : `${hhmm} is inside the ${pad(endHour)}:00–${pad(startHour)}:00 ET coverage window`,
  };
}

function pad(h: number): string {
  return String(h).padStart(2, "0");
}

export type Breakdown = {
  factors: Array<{ key: string; label: string; value: string; raw: number; weight: number; weighted: number }>;
  score: number;
  asset: CriticalAsset | null;
};

export function scoreAlert(alert: Alert, config: GateConfig, assets: CriticalAsset[]): Breakdown {
  const asset = alert.host ? (assets.find((a) => a.hostname.toLowerCase() === alert.host!.toLowerCase()) ?? null) : null;
  const impact = asset?.businessImpact ?? alert.businessImpact;
  const w = config.weights;
  const total = w.severity + w.confidence + w.assetCriticality + w.businessImpact || 1;
  const raws = {
    severity: config.severityScores[alert.severity] ?? 50,
    confidence: config.confidenceScores[alert.confidence] ?? 50,
    assetCriticality: asset ? (config.assetTierScores[asset.tier] ?? 40) : config.assetTierScores.unknown,
    businessImpact: config.businessImpactScores[impact] ?? 45,
  };
  const factors = [
    { key: "severity", label: "Severity", value: alert.severity, raw: raws.severity, weight: w.severity / total },
    { key: "confidence", label: "Detection confidence", value: alert.confidence, raw: raws.confidence, weight: w.confidence / total },
    {
      key: "assetCriticality",
      label: "Asset criticality",
      value: asset ? `${asset.tier} · ${asset.hostname}` : alert.host ? `${alert.host} not in CMDB` : "no host",
      raw: raws.assetCriticality,
      weight: w.assetCriticality / total,
    },
    { key: "businessImpact", label: "Business impact", value: impact.replace(/_/g, " "), raw: raws.businessImpact, weight: w.businessImpact / total },
  ].map((f) => ({ ...f, weighted: round(f.raw * f.weight) }));
  const score = round(factors.reduce((sum, f) => sum + f.weighted, 0));
  return { factors, score, asset };
}

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export type GateResult = {
  decision: Decision;
  score: number;
  threshold: number;
  afterHours: boolean;
  clockMode: ClockMode;
  reason: string;
  breakdown: Breakdown;
};

export function decideAlert(alert: Alert, config: GateConfig, assets: CriticalAsset[], clockMode: ClockMode): GateResult {
  const breakdown = scoreAlert(alert, config, assets);
  const at = new Date(alert.receivedAt);
  const { afterHours, basis } = isAfterHours(Number.isNaN(at.getTime()) ? new Date() : at, config, clockMode);
  const drivers = breakdown.factors
    .slice()
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 2)
    .map((f) => `${f.label.toLowerCase()} ${f.value} (${f.raw}×${f.weight.toFixed(2)}=${f.weighted})`)
    .join(", ");

  let decision: Decision;
  let reason: string;
  if (!afterHours) {
    decision = "bypass_business_hours";
    reason = `Not paged: ${basis}, so the alert follows the normal daytime queue. Score ${breakdown.score}.`;
  } else if (breakdown.score >= config.pageThreshold) {
    decision = "page";
    reason = `Paged on-call: score ${breakdown.score} ≥ threshold ${config.pageThreshold}; ${basis}. Top drivers: ${drivers}.`;
  } else if (breakdown.score < config.suppressBelowScore) {
    decision = "suppressed";
    reason = `Auto-suppressed: score ${breakdown.score} < suppress floor ${config.suppressBelowScore}; ${basis}. Top drivers: ${drivers}.`;
  } else {
    decision = "deferred";
    reason = `Deferred to the morning digest: score ${breakdown.score} < threshold ${config.pageThreshold} but ≥ suppress floor ${config.suppressBelowScore}; ${basis}.`;
  }
  return { decision, score: breakdown.score, threshold: config.pageThreshold, afterHours, clockMode, reason, breakdown };
}

export function logEvent(db: Database, at: string, kind: string, message: string, meta: unknown = {}): void {
  db.query("INSERT INTO timeline (at, kind, message, meta) VALUES (?, ?, ?, ?)").run(at, kind, message, JSON.stringify(meta));
}

export function saveAlert(db: Database, alert: Alert): void {
  db.query(
    `INSERT INTO alerts (id, source, received_at, title, severity, confidence, user_name, host, indicator, json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, title = excluded.title`,
  ).run(
    alert.id,
    alert.source,
    alert.receivedAt,
    alert.title,
    alert.severity,
    alert.confidence,
    alert.user ?? null,
    alert.host ?? null,
    alert.indicator ?? null,
    JSON.stringify(alert),
  );
}

export function recordDecision(db: Database, alert: Alert, result: GateResult, replayed = false): void {
  db.query(
    `INSERT INTO gate_decisions (alert_id, decided_at, decision, score, threshold, after_hours, clock_mode, reason, breakdown, replayed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(alert_id) DO UPDATE SET
       decided_at = excluded.decided_at, decision = excluded.decision, score = excluded.score,
       threshold = excluded.threshold, after_hours = excluded.after_hours, clock_mode = excluded.clock_mode,
       reason = excluded.reason, breakdown = excluded.breakdown, replayed = excluded.replayed`,
  ).run(
    alert.id,
    alert.receivedAt,
    result.decision,
    result.score,
    result.threshold,
    result.afterHours ? 1 : 0,
    result.clockMode,
    result.reason,
    JSON.stringify(result.breakdown),
    replayed ? 1 : 0,
  );

  if (result.decision === "deferred") {
    db.query(
      `INSERT INTO deferred_queue (alert_id, queued_at, score, reason) VALUES (?, ?, ?, ?)
       ON CONFLICT(alert_id) DO UPDATE SET score = excluded.score, reason = excluded.reason, digested_at = NULL`,
    ).run(alert.id, alert.receivedAt, result.score, result.reason);
  } else {
    db.query("DELETE FROM deferred_queue WHERE alert_id = ?").run(alert.id);
  }

  logEvent(db, alert.receivedAt, `decision:${result.decision}`, `${alert.source} · ${alert.title}`, {
    alertId: alert.id,
    score: result.score,
    threshold: result.threshold,
    decision: result.decision,
    replayed,
  });
}

export function pagePayload(alert: Alert, result: GateResult, config: GateConfig) {
  return {
    routing_key: "mock-pagerduty-routing-key",
    event_action: "trigger",
    dedup_key: `soc-gate-${alert.id}`,
    payload: {
      summary: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      severity: alert.severity === "info" ? "info" : alert.severity === "low" ? "warning" : alert.severity,
      source: alert.host ?? alert.source,
      component: alert.source,
      group: result.breakdown.asset?.businessService ?? "unmapped",
      class: "after-hours-escalation",
      custom_details: {
        gate_score: result.score,
        threshold: result.threshold,
        reason: result.reason,
        user: alert.user ?? null,
        host: alert.host ?? null,
        indicator: alert.indicator ?? null,
        asset_tier: result.breakdown.asset?.tier ?? "unknown",
        asset_owner: result.breakdown.asset?.owner ?? "unknown",
        on_call: config.delivery.onCallName,
      },
    },
  };
}

export function slackPageBlocks(alert: Alert, result: GateResult, config: GateConfig) {
  const asset = result.breakdown.asset;
  const fields = [
    `*Score*\n${result.score} / threshold ${result.threshold}`,
    `*Severity · confidence*\n${alert.severity} · ${alert.confidence}`,
    `*Host*\n${alert.host ?? "—"}${asset ? ` (${asset.tier}, ${asset.businessService})` : ""}`,
    `*User*\n${alert.user ?? "—"}`,
    `*Source*\n${alert.source}`,
    `*On-call*\n${config.delivery.onCallName}`,
  ];
  return [
    { type: "header", text: { type: "plain_text", text: `📟 After-hours page: ${truncate(alert.title, 120)}` } },
    { type: "section", fields: fields.map((text) => ({ type: "mrkdwn", text })) },
    { type: "section", text: { type: "mrkdwn", text: `*Why this paged*\n${result.reason}` } },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `Mock PagerDuty dedup key \`soc-gate-${alert.id}\` · alert received ${alert.receivedAt}` }],
    },
  ];
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export async function postSlack(channel: string, text: string, blocks?: unknown): Promise<{ ok: boolean; ts?: string; error?: string }> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, ...(blocks ? { blocks } : {}) }),
    });
    const body = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    return { ok: Boolean(body.ok), ts: body.ts, error: body.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Creates the mock PagerDuty event and, unless page notifications are off, the real Slack page notice. */
export async function pageOnCall(
  db: Database,
  alert: Alert,
  result: GateResult,
  config: GateConfig,
  options: { forceSlack?: boolean } = {},
): Promise<{ pageId: string; slack: { ok: boolean; ts?: string; error?: string; skipped?: boolean } }> {
  const pageId = `PD-${alert.id}`;
  const payload = pagePayload(alert, result, config);
  const sendSlack = options.forceSlack === true || config.notifications.pageSlack;
  const slack: { ok: boolean; ts?: string; error?: string; skipped?: boolean } = sendSlack
    ? await postSlack(
        config.delivery.slackChannel,
        `After-hours page (score ${result.score}): ${alert.title}`,
        slackPageBlocks(alert, result, config),
      )
    : { ok: true, skipped: true };
  db.query(
    `INSERT INTO paged_events (id, alert_id, created_at, status, on_call, score, payload, slack_channel, slack_ts, slack_error)
     VALUES (?, ?, ?, 'triggered', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       created_at = excluded.created_at, status = 'triggered', score = excluded.score,
       payload = excluded.payload, slack_ts = excluded.slack_ts, slack_error = excluded.slack_error,
       acked_at = NULL, resolved_at = NULL`,
  ).run(
    pageId,
    alert.id,
    alert.receivedAt,
    config.delivery.onCallName,
    result.score,
    JSON.stringify(payload),
    config.delivery.slackChannel,
    slack.ts ?? null,
    slack.skipped ? "skipped: Slack page notices disabled" : slack.ok ? null : (slack.error ?? "unknown_error"),
  );
  logEvent(db, alert.receivedAt, "page", `Paged ${config.delivery.onCallName} for ${alert.title}`, {
    alertId: alert.id,
    pageId,
    slackOk: slack.ok,
    slackSkipped: slack.skipped === true,
    slackError: slack.error ?? null,
  });
  return { pageId, slack };
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const CONFIDENCES: Confidence[] = ["confirmed", "high", "medium", "low"];
const IMPACTS: BusinessImpact[] = ["revenue_impacting", "customer_data", "internal_only", "none"];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const v = String(value ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  const alias: Record<string, string> = {
    sev0: "critical",
    sev1: "high",
    sev2: "medium",
    sev3: "low",
    informational: "info",
    p1: "critical",
    p2: "high",
    p3: "medium",
    p4: "low",
    "1": "critical",
    "2": "high",
    "3": "medium",
    "4": "low",
    true_positive: "confirmed",
    certain: "confirmed",
    revenue: "revenue_impacting",
    pii: "customer_data",
    phi: "customer_data",
  };
  const mapped = (alias[v] ?? v) as T;
  return allowed.includes(mapped) ? mapped : fallback;
}

/** Accepts loosely shaped vendor payloads and returns the workflow's canonical alert. */
export function normalizeAlert(raw: unknown, receivedAt: string, idSuffix: string): Alert {
  const r = (raw ?? {}) as Record<string, any>;
  const source = String(r.source ?? r.product ?? r.vendor ?? "unknown").toLowerCase().trim() || "unknown";
  const externalId = r.externalId ?? r.external_id ?? r.id ?? r.incidentId ?? r.alert_id;
  const host = firstString(r.host, r.hostname, r.device, r.deviceName, r.computer, r.asset);
  const user = firstString(r.user, r.userName, r.username, r.account, r.upn, r.recipient);
  const indicator = firstString(r.indicator, r.ioc, r.url, r.hash, r.sha256, r.destinationIp, r.dest_ip, r.sender);
  const idBasis = String(externalId ?? `${source}-${host ?? user ?? indicator ?? "unmapped"}`);
  return {
    id: `${slug(source)}-${slug(idBasis)}-${idSuffix}`.slice(0, 96),
    source,
    externalId: externalId === undefined ? undefined : String(externalId),
    receivedAt,
    title: firstString(r.title, r.name, r.summary, r.description) ?? `${source} alert`,
    description: firstString(r.description, r.details, r.body),
    severity: pick(r.severity ?? r.sev ?? r.priority, SEVERITIES, "medium"),
    confidence: pick(r.confidence ?? r.detectionConfidence ?? r.verdict, CONFIDENCES, "medium"),
    user,
    host: host?.toLowerCase(),
    indicator,
    businessImpact: pick(r.businessImpact ?? r.business_impact ?? r.impact, IMPACTS, "internal_only"),
    tags: Array.isArray(r.tags) ? r.tags.map((t: unknown) => String(t)) : undefined,
    raw,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
}

/** Parses stdin whether it arrives as an HTTP request (route trigger) or raw JSON (link trigger). */
export function parseInput(raw: string): { body: unknown; method: string; isHttp: boolean; query: URLSearchParams } {
  const text = raw ?? "";
  const httpMatch = /^([A-Z]+) (\S+) HTTP\/\d(?:\.\d)?\r?\n/.exec(text);
  if (!httpMatch) {
    return { body: safeJson(text.trim()), method: "LINK", isHttp: false, query: new URLSearchParams() };
  }
  const sepIndex = text.indexOf("\r\n\r\n") >= 0 ? text.indexOf("\r\n\r\n") + 4 : text.indexOf("\n\n") + 2;
  const body = sepIndex > 1 ? text.slice(sepIndex) : "";
  const url = new URL(httpMatch[2], "http://localhost");
  return { body: safeJson(body.trim()), method: httpMatch[1], isHttp: true, query: url.searchParams };
}

export function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function httpResponse(status: number, statusText: string, body: string, contentType = "application/json; charset=utf-8"): string {
  const bytes = Buffer.byteLength(body);
  return [
    `HTTP/1.1 ${status} ${statusText}`,
    `content-type: ${contentType}`,
    `content-length: ${bytes}`,
    "cache-control: no-store",
    "",
    body,
  ].join("\r\n");
}
