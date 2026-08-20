// Types and fetch helpers for the console. All three endpoints live on this
// workflow's own routes, so paths are derived from the page's route prefix
// (which already carries the draft-branch prefix when serving a draft).

export type RunStatus = "ok" | "degraded" | "failed" | "running" | "stalled";

export type LogLine = {
  step: string;
  ts: string;
  durationMs: number | null;
  level: "info" | "warn" | "error";
  message: string;
  data: Record<string, unknown> | null;
};

export type Triage = {
  rootCause: string;
  confidence: string;
  note: string;
  model: string;
  owner?: string;
  generatedAt?: string;
  proposedFix?: {
    kind: string;
    source: string;
    fromField: string;
    toField: string;
    description: string;
  } | null;
};

export type Run = {
  runId: string;
  batchId: string;
  chaos: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: RunStatus;
  sources: string[];
  recordsIn: number;
  recordsOut: number;
  duplicates: number;
  rejected: number;
  quarantined: number;
  qualityScore: number | null;
  error: {
    source: string;
    field: string | null;
    recordId: string | null;
    message: string;
    changedVsLastGoodRun: string | null;
    owner: string;
  } | null;
  triage: Triage | null;
  timeline: { step: string; durationMs: number; lines: number }[];
  logs: LogLine[];
  rejectionsByReason: { reasonCode: string; count: number }[];
};

export type QuarantineItem = {
  id: number;
  runId: string;
  trialId: string;
  ndc: string;
  reasonCode: string;
  detail: string;
  matchedField: string;
  source: string;
  status: "open" | "released" | "dismissed";
  decidedAt: string | null;
  decidedBy: string | null;
};

export type ConsolePayload = {
  ok: boolean;
  generatedAt: string;
  runs: Run[];
  health: {
    lastRunStatus: RunStatus | "none";
    lastRunId: string | null;
    lastRunAt: string | null;
    qualityTrend: { runId: string; startedAt: string; score: number; status: RunStatus }[];
    publishedLast24h: number;
    totalPublished: number;
    openQuarantines: number;
  };
  rejectionBreakdown: { reasonCode: string; count: number }[];
  quarantine: QuarantineItem[];
  remediations: {
    source: string;
    fromField: string;
    toField: string;
    approvedAt: string;
    approvedBy: string;
    runId: string | null;
  }[];
};

// `window.__ROUTE_PATH__` is this page's own route (…/atlas), branch prefix
// included. The API endpoints are its siblings.
const ROUTE = (window as unknown as { __ROUTE_PATH__?: string }).__ROUTE_PATH__ ?? "/atlas";

export async function fetchConsole(signal?: AbortSignal): Promise<ConsolePayload> {
  const response = await fetch(`${ROUTE}/data?limit=25`, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`data feed responded ${response.status}`);
  return (await response.json()) as ConsolePayload;
}

export async function triggerRun(simulateFailure: string): Promise<{ runId: string; batchId: string }> {
  const response = await fetch(`${ROUTE}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ simulate_failure: simulateFailure }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? `trigger responded ${response.status}`);
  return payload;
}

export async function decideQuarantine(id: number, decision: "approve" | "dismiss") {
  const response = await fetch(`${ROUTE}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "quarantine", id, decision }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? `action responded ${response.status}`);
  return payload;
}

export async function approveRemediation(runId: string) {
  const response = await fetch(`${ROUTE}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "remediation", runId }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? `action responded ${response.status}`);
  return payload;
}

export const CHAOS_MODES = [
  { value: "none", label: "None — clean run" },
  { value: "schema_drift", label: "Schema drift — partner_csv renames a column" },
  { value: "source_timeout", label: "Source timeout — partner_fhir unreachable" },
  { value: "encoding_error", label: "Encoding error — non-UTF-8 partner text" },
] as const;

export function formatDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
