declare global {
  interface Window {
    __ROUTE_PATH__?: string;
    __API_ROOT__?: string;
    __BRANCH__?: string;
  }
}

export const API_ROOT = typeof window === "undefined" ? "" : (window.__API_ROOT__ ?? "");
export const BRANCH = typeof window === "undefined" ? "live" : (window.__BRANCH__ ?? "live");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const detail =
      parsed && typeof parsed === "object" && "error" in parsed
        ? typeof (parsed as { error: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : JSON.stringify((parsed as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new ApiError(detail, response.status, parsed);
  }
  return parsed as T;
}

export const get = <T,>(path: string) => request<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const patch = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });

// --- shapes returned by this workflow's routes -----------------------------

export type QualysDetection = {
  ID: string;
  QID: number;
  TYPE: string;
  TITLE: string;
  CATEGORY: string;
  VULN_CLASS: string;
  SEVERITY: number;
  CVSS: { BASE: number; TEMPORAL: number; VECTOR: string };
  CVE_LIST: string[];
  THREAT_INTEL: {
    KNOWN_EXPLOITED: boolean;
    EXPLOIT_IN_THE_WILD: boolean;
    CISA_KEV_DUE_DATE: string | null;
  };
  PATCH_AVAILABLE: boolean;
  STATUS: string;
  FINDING_TYPE: string;
  ASSET: {
    ASSET_ID: string;
    HOSTNAME: string;
    IP: string;
    OS: string;
    TAGS: string[];
    EXPOSURE_OVERRIDE: string | null;
  };
  SOFTWARE: Record<string, unknown>;
  RESULTS: string;
  SOLUTION: string;
  FIRST_FOUND_DATETIME: string;
  LAST_FOUND_DATETIME: string;
  LAST_UPDATE_DATETIME: string;
  TIMES_DETECTED: number;
};

export type RiskFactor = {
  factor: string;
  input: string;
  points: number;
  max_points: number;
  detail: string;
};

export type RiskAssessment = {
  risk_score: number;
  risk_band: string;
  sla_days: number;
  sla_due: string;
  factors: RiskFactor[];
  explanation: string;
  high_priority: boolean;
};

export type RemediationPackage = {
  finding_id?: string;
  determinable: boolean;
  summary: string;
  required_fix: string;
  fix_version: string | null;
  commands: { platform: string; description: string; command: string }[];
  code_fix: { file: string; language: string; before: string; after: string; note: string } | null;
  prerequisites: string[];
  reboot_required: boolean;
  service_impact: string;
  validation: string[];
  evidence_citations: string[];
  missing_evidence: string[];
  confidence: string;
  source: string;
};

export type Owner = {
  application: string;
  team: string;
  assignment_group: string;
  owner_email: string;
  criticality: string;
  exposure: string;
  environment: string;
  owned: boolean;
};

export type Finding = {
  finding_id: string;
  qid: number;
  title: string;
  vuln_class: string;
  finding_type: string;
  severity: number;
  cvss_base: number;
  cves: string[];
  kev: boolean;
  exploit_in_wild: boolean;
  patch_available: boolean;
  status: string;
  asset: { asset_id: string; hostname: string; ip: string; os: string; tags: string[] };
  software: Record<string, unknown>;
  evidence: string;
  vendor_solution: string;
  owner: Owner;
  risk?: RiskAssessment;
  remediation?: RemediationPackage;
};

export type StageStatus = {
  stage: string;
  status: string;
  run_id: string | null;
  trigger: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  record_count: number | null;
  summary: string;
  error: string | null;
};

export type ConsoleState = {
  as_of: string;
  branch: string;
  branch_id: string | null;
  clock_offset_days: number;
  last_pull_at: string | null;
  weights: Record<string, number>;
  default_weights: Record<string, number>;
  bands: Record<string, number>;
  sla_days: Record<string, number>;
  high_priority_score: number;
  stages: StageStatus[];
  history: {
    id: number;
    run_id: string;
    stage: string;
    trigger: string;
    status: string;
    started_at: string;
    duration_ms: number;
    record_count: number;
    summary: string;
  }[];
  has_report: boolean;
};

export type Ticket = {
  sys_id: string;
  number: string;
  short_description: string;
  description: string;
  assignment_group: string;
  team: string;
  application: string;
  priority: number;
  risk_score: number;
  risk_band: string;
  state: string;
  opened_at: string;
  updated_at: string;
  due_date: string;
  closed_at: string | null;
  escalation_level: number;
  finding_count: number;
  finding_ids: string[];
  days_to_due: number | null;
  overdue: boolean;
  findings: { findings?: Record<string, unknown>[] };
  work_notes: { created_at: string; author: string; note: string }[];
};

export type ReportMetrics = {
  window_days: number;
  window_start: string;
  window_end: string;
  opened: number;
  closed: number;
  open_now: number;
  overdue_now: number;
  findings_opened: number;
  findings_closed: number;
  mttr_days: number | null;
  mttr_sample: number;
  sla_attainment_pct: number | null;
  closed_within_sla: number;
  closed_late: number;
  oldest_overdue_days: number | null;
  by_band: { band: string; open: number; closed_in_window: number }[];
  by_team: {
    team: string;
    open: number;
    overdue: number;
    closed_in_window: number;
    worst_days_overdue: number;
  }[];
  top_vuln_classes: { vuln_class: string; findings: number; changes: number }[];
  trend: { date: string; opened: number; closed: number }[];
  overdue_changes: {
    number: string;
    team: string;
    application: string;
    days_overdue: number;
    priority: number;
    risk_score: number;
    finding_count: number;
    escalation_level: number;
  }[];
};

export type ScorePreview = {
  weights: Record<string, number>;
  source_stage: string | null;
  high_priority_score: number;
  findings: {
    finding_id: string;
    title: string;
    hostname: string;
    team: string;
    application: string;
    criticality: string;
    exposure: string;
    severity: number;
    cvss_base: number;
    kev: boolean;
    exploit_in_wild: boolean;
    baseline_score: number | null;
    risk: RiskAssessment;
  }[];
};

// --- calls ----------------------------------------------------------------

export type OwnerEntry = {
  application: string;
  team: string;
  assignment_group: string;
  owner_email: string;
  criticality: string;
  exposure: string;
  environment: string;
};

export const api = {
  state: () => get<ConsoleState>("/api/console"),
  owners: () =>
    get<{ owners: Record<string, OwnerEntry>; fallback: OwnerEntry }>("/api/console?view=owners"),
  enrichedFindings: () =>
    get<{ run_id: string | null; stage: string | null; findings: Finding[] }>(
      "/api/console?view=findings",
    ),
  stagePayload: (stage: string) =>
    get<{ stage: string; payload: unknown; record: unknown }>(
      `/api/console?view=stage&stage=${encodeURIComponent(stage)}`,
    ),
  report: () =>
    get<{ as_of: string; report: { markdown: string; metrics: ReportMetrics; as_of: string } | null }>(
      "/api/console?view=report",
    ),
  scorePreview: (weights: Record<string, number>) =>
    post<ScorePreview>("/api/console", { action: "score_preview", weights }),
  setWeights: (weights: Record<string, number>) =>
    post<{ weights: Record<string, number> }>("/api/console", { action: "set_weights", weights }),
  resetWeights: () => post<{ weights: Record<string, number> }>("/api/console", { action: "reset_weights" }),
  advanceClock: (days: number) =>
    post<{ clock_offset_days: number; as_of: string }>("/api/console", {
      action: "advance_clock",
      days,
    }),
  setClock: (offsetDays: number) =>
    post<{ clock_offset_days: number; as_of: string }>("/api/console", {
      action: "set_clock",
      offset_days: offsetDays,
    }),
  resetPipelineState: () => post("/api/console", { action: "reset_pipeline_state" }),

  detections: () =>
    get<{ count: number; data: QualysDetection[] }>("/mock/qualys/findings"),
  injectDetection: (preset: string) =>
    post<{ id: string }>("/mock/qualys/findings", { action: "inject", preset }),
  resetDetections: () => post("/mock/qualys/findings", { action: "reset" }),
  editDetection: (body: Record<string, unknown>) => patch("/mock/qualys/findings", body),
  remediateDetection: (id: string) =>
    patch("/mock/qualys/findings", { id, action: "remediate" }),

  tickets: () =>
    get<{ result: Ticket[]; count: number; as_of: string; open_count: number; overdue_count: number }>(
      "/mock/servicenow",
    ),
  closeTicket: (sysId: string) => patch("/mock/servicenow", { sys_id: sysId, action: "close" }),
  seedHistory: () => post("/mock/servicenow", { action: "seed_history" }),
  resetTickets: () => post("/mock/servicenow", { action: "reset" }),

  runPipeline: () => post("/run/pull", { force: true }),
  runIncrementalPull: () => post("/run/pull", {}),
  runStage: (stage: string) => post(`/run/${stage}?only=1`, {}),
  runChase: () => post("/run/chase", {}),
  runReport: () => post("/run/report", {}),
  pushWebhook: (externalId: string, detection: unknown) =>
    post(
      `/webhook/qualys${externalId ? `?external_id=${encodeURIComponent(externalId)}` : ""}`,
      detection,
    ),
};
