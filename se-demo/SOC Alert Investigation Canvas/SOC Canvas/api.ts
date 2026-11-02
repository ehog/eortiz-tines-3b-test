declare global {
  interface Window {
    __ROUTE_PATH__?: string;
  }
}

export const BASE = (window.__ROUTE_PATH__ ?? "").replace(/\/+$/, "");

export const SOURCE_KEYS = ["defender", "sentinel", "zscaler", "proofpoint", "threatintel"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export const SOURCE_LABELS: Record<string, string> = {
  defender: "Microsoft Defender",
  sentinel: "Microsoft Sentinel",
  zscaler: "Zscaler",
  proofpoint: "Proofpoint TAP",
  threatintel: "Threat intel",
};

export interface TimelineEvent {
  id: string;
  ts: string;
  source: string;
  title: string;
  detail: string;
  entity: string;
  severity: string;
}

export interface LogRecord {
  ts: string;
  investigationId: string;
  step: string;
  event: string;
  target: string;
  outcome: string;
  durationMs: number;
}

export interface Investigation {
  investigationId: string;
  incident: {
    source: string;
    vendorId: string;
    correlationId: string;
    title: string;
    description: string;
    severity: string;
    status: string;
    alertTime: string;
    receivedAt: string;
    raw: unknown;
  };
  entities: {
    users: string[];
    devices: string[];
    internalIps: string[];
    externalIps: string[];
    urls: string[];
    domains: string[];
    hashes: string[];
    processes: string[];
  } | null;
  sources: Record<
    string,
    {
      source: string;
      label?: string;
      status: string;
      mocked?: boolean;
      durationMs?: number;
      recordCount?: number;
      eventCount?: number;
      data?: Record<string, unknown>;
    }
  >;
  timeline: { events: TimelineEvent[]; eventCount: number; missingSources: string[]; builtAt: string } | null;
  summary: {
    headline: string;
    summary: string;
    attackNarrative: string;
    disposition: string;
    confidence: number;
    evidence: { claim: string; eventIds: string[] }[];
    gaps: string[];
    recommendedActions: string[];
    model: string;
    generatedAt: string;
  } | null;
  servicenow: { number: string; url: string; action: string; state: string; priority: string; workNote: string } | null;
  actions: { ts: string; action: string; device: string; analyst: string; outcome: string; machineActionId: string }[];
  logs: LogRecord[];
  screenshots: { index: number; file: string; label: string; capturedAt: string; verdict: string }[];
  isolate: { device: string; token: string | null; alreadyIsolated: boolean };
  status: {
    incident: boolean;
    entities: boolean;
    sources: Record<string, boolean>;
    timeline: boolean;
    summary: boolean;
    servicenow: boolean;
    complete: boolean;
  };
}

export interface RecentInvestigation {
  investigationId: string;
  title: string;
  source: string;
  severity: string;
  receivedAt: string;
  disposition: string | null;
  confidence: number | null;
  servicenowNumber: string | null;
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export async function fetchInvestigation(id: string): Promise<Investigation> {
  return parse<Investigation>(await fetch(`${BASE}/api/investigation?id=${encodeURIComponent(id)}`));
}

export async function fetchRecent(): Promise<RecentInvestigation[]> {
  const data = await parse<{ investigations: RecentInvestigation[] }>(await fetch(`${BASE}/api/investigation`));
  return data.investigations;
}

export function newInvestigationId(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `inv-${stamp}-${suffix}`;
}

export async function launchIncident(payload: unknown): Promise<string> {
  const investigationId = newInvestigationId();
  const response = await fetch(`${BASE}/incident?id=${investigationId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`intake returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return investigationId;
}

export async function retrySource(investigationId: string, source: SourceKey): Promise<void> {
  const response = await fetch(`${BASE}/api/enrich/${source}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ investigationId }),
  });
  if (!response.ok) throw new Error(`retry of ${source} returned ${response.status}`);
}

export async function forceTimeline(investigationId: string): Promise<void> {
  const response = await fetch(`${BASE}/api/timeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ investigationId, force: true }),
  });
  if (!response.ok) throw new Error(`timeline build returned ${response.status}`);
}

export async function rerunStage(investigationId: string, stage: "summarize" | "servicenow"): Promise<void> {
  const response = await fetch(`${BASE}/api/${stage}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ investigationId }),
  });
  if (!response.ok) throw new Error(`re-run of ${stage} returned ${response.status}`);
}

export async function isolateEndpoint(input: {
  investigationId: string;
  device: string;
  token: string;
  comment: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}/api/isolate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, approved: true }),
  });
  return parse<Record<string, unknown>>(response);
}

export function screenshotUrl(investigationId: string, index: number): string {
  return `${BASE}/api/screenshot?id=${encodeURIComponent(investigationId)}&index=${index}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 19) + "Z";
}
