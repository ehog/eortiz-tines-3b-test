export const CHAOS_KEYS = [
  "proofpoint_500",
  "zscaler_timeout",
  "defender_429",
  "servicenow_400",
  "isolate_fail",
] as const;

export type ChaosKey = (typeof CHAOS_KEYS)[number];
export type ChaosMode = "fail_n" | "always";

export interface ChaosSetting {
  enabled: boolean;
  mode: ChaosMode;
  failures: number;
}

export type ChaosConfig = Record<ChaosKey, ChaosSetting>;

export const CHAOS_META: Record<ChaosKey, { label: string; service: string; effect: string; stage: string }> = {
  proofpoint_500: { label: "Proofpoint 500", service: "Proofpoint TAP", effect: "HTTP 500 — transient, retried", stage: "proofpoint_enrich" },
  zscaler_timeout: { label: "Zscaler timeout", service: "Zscaler", effect: "no response — 4s deadline expires", stage: "zscaler_enrich" },
  defender_429: { label: "Defender 429", service: "Defender", effect: "HTTP 429 + Retry-After — throttled", stage: "defender_query" },
  servicenow_400: { label: "ServiceNow 400", service: "ServiceNow", effect: "HTTP 400 — permanent, never retried", stage: "servicenow_create" },
  isolate_fail: { label: "Isolation failure", service: "Defender", effect: "HTTP 503 — transient, ticket already exists", stage: "endpoint_isolate" },
};

export const STAGE_META: { key: string; label: string; service: string; timeout: string; retries: string; sideEffect: boolean }[] = [
  { key: "proofpoint_enrich", label: "Proofpoint enrich", service: "Proofpoint TAP", timeout: "5s", retries: "3 retries", sideEffect: false },
  { key: "zscaler_enrich", label: "Zscaler lookup", service: "Zscaler", timeout: "4s", retries: "3 retries", sideEffect: false },
  { key: "defender_query", label: "Defender query", service: "Defender", timeout: "6s", retries: "4 retries", sideEffect: false },
  { key: "servicenow_create", label: "ServiceNow incident", service: "ServiceNow", timeout: "8s", retries: "2 retries", sideEffect: true },
  { key: "endpoint_isolate", label: "Isolate endpoint", service: "Defender", timeout: "8s", retries: "2 retries", sideEffect: true },
];

export const FOLLOW_UP_STAGES: Record<string, string> = {
  servicenow_flag_incomplete: "Flag ticket incomplete",
  servicenow_clear_flag: "Clear ticket flag",
};

export interface RunSummary {
  runId: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  alertId: string;
  endpoint: string;
  userEmail: string;
  severity: string;
  status: string;
  chaos: ChaosConfig | null;
  ticketNumber: string | null;
  ticketSysId: string | null;
  ticketState: string | null;
  isolationState: string | null;
  failedStage: string | null;
  failureReason: string | null;
  failureClass: string | null;
  guardrail: string | null;
  safeToRetry: boolean;
  resumeCount: number;
}

export interface StageState {
  stage: string;
  position: number;
  status: string;
  attempts: number;
  startedRelMs: number | null;
  durationMs: number | null;
  timeoutMs: number | null;
  maxRetries: number | null;
  statusCode: number | null;
  classification: string | null;
  requestKey: string | null;
  detail: string | null;
  updatedAt: string;
}

export interface AttemptEntry {
  id: number;
  ts: string;
  relMs: number;
  stage: string;
  attempt: number;
  event: string;
  level: string;
  outcome: string;
  statusCode: number | null;
  classification: string | null;
  latencyMs: number | null;
  message: string;
  payload: Record<string, unknown> | null;
}

export interface AuditEntry {
  id: number;
  ts: string;
  relMs: number;
  actor: string;
  stage: string;
  action: string;
  target: string;
  requestKey: string | null;
  attempt: number | null;
  outcome: string;
  statusCode: number | null;
  classification: string | null;
  latencyMs: number | null;
  detail: string;
}

export interface RunDetail {
  runs: RunSummary[];
  run: RunSummary | null;
  stages: StageState[];
  attempts: AttemptEntry[];
  audit: AuditEntry[];
  resume: { resumeFrom: string | null; willSkip: string[]; allowed: boolean } | null;
}

const routePath: string = (globalThis as { __ROUTE_PATH__?: string }).__ROUTE_PATH__ ?? "/containment";
export const API_BASE = routePath.replace(/\/containment$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response from ${path}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const detail = (body as { details?: string[]; error?: string } | null)?.details?.join("; ");
    throw new Error(detail || (body as { error?: string } | null)?.error || `HTTP ${response.status}`);
  }
  return body as T;
}

export function fetchRuns(limit = 20): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/list?limit=${limit}`);
}

export function fetchRun(runId: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/list?runId=${encodeURIComponent(runId)}`);
}

export function startRun(payload: {
  alertId: string;
  endpoint: string;
  userEmail: string;
  severity: string;
  chaos: ChaosConfig;
}): Promise<{ runId: string; status: string }> {
  return request(`/api/runs`, { method: "POST", body: JSON.stringify(payload) });
}

export function resumeRun(runId: string, chaos: ChaosConfig | null, clearChaos: boolean): Promise<{
  runId: string;
  resumeFrom: string;
  skipping: string[];
  resumeCount: number;
}> {
  return request(`/api/runs/retry`, {
    method: "POST",
    body: JSON.stringify(clearChaos ? { runId, clearChaos: true } : { runId, chaos }),
  });
}

export function resetDemo(scope: "all" | "mocks"): Promise<{ ok: boolean; message: string }> {
  return request(`/api/demo/reset`, { method: "POST", body: JSON.stringify({ scope }) });
}

export function defaultChaos(): ChaosConfig {
  return CHAOS_KEYS.reduce((acc, key) => {
    acc[key] = { enabled: false, mode: "fail_n", failures: 2 };
    return acc;
  }, {} as ChaosConfig);
}

export const PRESETS: { id: string; label: string; hint: string; chaos: () => ChaosConfig }[] = [
  { id: "clean", label: "Clean run", hint: "everything succeeds first try", chaos: () => defaultChaos() },
  {
    id: "recovery",
    label: "Transient recovery",
    hint: "Proofpoint 500 x2 then success, Defender throttled once",
    chaos: () => ({
      ...defaultChaos(),
      proofpoint_500: { enabled: true, mode: "fail_n", failures: 2 },
      defender_429: { enabled: true, mode: "fail_n", failures: 1 },
    }),
  },
  {
    id: "timeout",
    label: "Zscaler timeout",
    hint: "no response until the 4s deadline, retries exhausted",
    chaos: () => ({ ...defaultChaos(), zscaler_timeout: { enabled: true, mode: "always", failures: 2 } }),
  },
  {
    id: "permanent",
    label: "Permanent reject",
    hint: "ServiceNow 400 — no retries, isolation blocked",
    chaos: () => ({ ...defaultChaos(), servicenow_400: { enabled: true, mode: "always", failures: 2 } }),
  },
  {
    id: "partial",
    label: "Partial containment",
    hint: "ticket created, isolation fails, ticket flagged incomplete",
    chaos: () => ({ ...defaultChaos(), isolate_fail: { enabled: true, mode: "always", failures: 2 } }),
  },
];

export function generateAlertId(): string {
  return `PP-${Math.floor(10000 + Math.random() * 89999)}`;
}
