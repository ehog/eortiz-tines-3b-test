export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Decision = "page" | "deferred" | "suppressed" | "bypass_business_hours";
export type ClockMode = "real" | "after_hours" | "business_hours";

export type Alert = {
  id: string;
  source: string;
  receivedAt: string;
  title: string;
  description?: string;
  severity: Severity;
  confidence: string;
  user?: string;
  host?: string;
  indicator?: string;
  businessImpact: string;
  tags?: string[];
  raw?: unknown;
};

export type Factor = { key: string; label: string; value: string; raw: number; weight: number; weighted: number };

export type GateConfig = {
  pageThreshold: number;
  suppressBelowScore: number;
  weights: { severity: number; confidence: number; assetCriticality: number; businessImpact: number };
  afterHours: { startHour: number; endHour: number; weekendsAlwaysAfterHours: boolean };
  severityScores: Record<string, number>;
  confidenceScores: Record<string, number>;
  businessImpactScores: Record<string, number>;
  assetTierScores: Record<string, number>;
  delivery: { slackChannel: string; emailTo: string; onCallName: string; onCallEmail: string; onCallPhone: string };
  digest: { lookbackHours: number; model: string };
  notifications: { digestEmail: boolean; digestSlack: boolean; pageSlack: boolean };
};

export type Asset = {
  hostname: string;
  tier: string;
  owner: string;
  businessService: string;
  businessImpact: string;
  notes: string;
};

export type DecisionRow = {
  alertId: string;
  decidedAt: string;
  decision: Decision;
  score: number;
  threshold: number;
  afterHours: boolean;
  clockMode: string;
  reason: string;
  replayed: boolean;
  breakdown: { factors: Factor[]; score: number; asset: Asset | null };
  alert: Alert;
};

export type PageRow = {
  id: string;
  alertId: string;
  title: string;
  createdAt: string;
  status: string;
  onCall: string;
  score: number;
  payload: Record<string, any>;
  slackChannel: string | null;
  slackTs: string | null;
  slackError: string | null;
  ackedAt: string | null;
  resolvedAt: string | null;
};

export type DeferredRow = {
  alertId: string;
  queuedAt: string;
  score: number;
  reason: string;
  digestedAt: string | null;
  alert: Alert;
};

export type DigestRow = {
  id: number;
  createdAt: string;
  status: string;
  windowStart: string | null;
  windowEnd: string | null;
  itemCount: number;
  markdown: string;
  html: string;
  slackText: string;
  meta: Record<string, any>;
  emailStatus: string | null;
  slackStatus: string | null;
};

export type TimelineRow = { id: number; at: string; kind: string; message: string; meta: Record<string, any> };

export type ConsoleState = {
  config: GateConfig;
  defaults: GateConfig;
  clockMode: ClockMode;
  assets: Asset[];
  scenarios: Array<{ id: string; name: string; description: string; alertCount: number }>;
  counters: {
    received: number;
    paged: number;
    deferred: number;
    suppressed: number;
    bypassed: number;
    pendingDeferred: number;
    openPages: number;
  };
  decisions: DecisionRow[];
  pages: PageRow[];
  deferredQueue: DeferredRow[];
  digests: DigestRow[];
  timeline: TimelineRow[];
  routes: { testAlert: string; runDigest: string; sendDigest: string; console: string };
};

const routePath: string = (window as unknown as { __ROUTE_PATH__?: string }).__ROUTE_PATH__ ?? "";
export const BASE = routePath.replace(/\/soc-console$/, "");

export async function fetchState(): Promise<ConsoleState> {
  const res = await fetch(`${BASE}/api/console`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Console API returned ${res.status}`);
  return (await res.json()) as ConsoleState;
}

export async function postAction(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string; state: ConsoleState }> {
  const res = await fetch(`${BASE}/api/console`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Console API returned ${res.status}`);
  return body as { ok: boolean; message?: string; state: ConsoleState };
}

export async function sendTestAlert(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE}/api/test-alert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 202) throw new Error(`Alert intake returned ${res.status}`);
}

export async function runDigest(): Promise<void> {
  const res = await fetch(`${BASE}/api/run-digest`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!res.ok && res.status !== 202) throw new Error(`Digest trigger returned ${res.status}`);
}

export async function sendDigestNotifications(channels: string[], digestId?: number): Promise<void> {
  const res = await fetch(`${BASE}/api/send-digest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channels, digestId, force: true }),
  });
  if (!res.ok && res.status !== 202) throw new Error(`Digest send returned ${res.status}`);
}

export const ET = "America/New_York";

export function etClock(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

export function etTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function etHour(date: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "2-digit", hour12: false }).format(date);
  return Number(h === "24" ? "0" : h);
}

export function etWeekday(date: Date): number {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" }).format(date);
  return Math.max(0, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day));
}

export function relative(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((now.getTime() - then) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}
