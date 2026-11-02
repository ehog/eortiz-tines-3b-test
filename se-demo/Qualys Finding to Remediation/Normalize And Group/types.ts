// Canonical shapes passed between pipeline stages. Each stage receives the
// previous stage's envelope on stdin and emits its own.

/** A detection exactly as the (mocked) Qualys VMDR API returns it. */
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

export type PullEnvelope = {
  run_id: string;
  trigger: "schedule" | "manual" | "webhook";
  stage: "pull";
  generated_at: string;
  detections: QualysDetection[];
  notes: string[];
};

export type Owner = {
  asset_id: string | null;
  hostname: string;
  application: string;
  team: string;
  assignment_group: string;
  owner_email: string;
  criticality: "critical" | "high" | "medium" | "low";
  exposure: "internet" | "dmz" | "internal" | "isolated";
  environment: string;
  owned: boolean;
};

export type NormalizedFinding = {
  finding_id: string;
  qid: number;
  title: string;
  vuln_class: string;
  finding_type: "missing_patch" | "third_party_library" | "code" | "config" | "unknown";
  severity: number;
  cvss_base: number;
  cvss_temporal: number;
  cvss_vector: string;
  cves: string[];
  kev: boolean;
  exploit_in_wild: boolean;
  kev_due_date: string | null;
  patch_available: boolean;
  status: string;
  detection_type: string;
  asset: {
    asset_id: string;
    hostname: string;
    ip: string;
    os: string;
    tags: string[];
  };
  software: Record<string, unknown>;
  evidence: string;
  vendor_solution: string;
  first_found: string;
  last_found: string;
  last_updated: string;
  times_detected: number;
  owner: Owner;
  // Added by Prioritize.
  risk?: RiskAssessment;
  // Added by Remediation Package (AI).
  remediation?: RemediationPackage;
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
  risk_band: "critical" | "high" | "medium" | "low";
  sla_days: number;
  sla_due: string;
  factors: RiskFactor[];
  explanation: string;
  high_priority: boolean;
};

export type RemediationPackage = {
  finding_id: string;
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
  confidence: "high" | "medium" | "low";
  source: "model" | "deterministic";
};

export type AssetGroup = {
  asset_id: string;
  hostname: string;
  os: string;
  finding_ids: string[];
};

export type TeamGroup = {
  team: string;
  application: string;
  assignment_group: string;
  owner_email: string;
  owned: boolean;
  finding_ids: string[];
  assets: AssetGroup[];
  max_risk_score?: number;
  risk_band?: string;
  sla_due?: string;
};

export type TicketSummary = {
  sys_id: string;
  number: string;
  team: string;
  assignment_group: string;
  action: "created" | "updated" | "unchanged";
  priority: number;
  risk_score: number;
  risk_band: string;
  due_date: string;
  finding_count: number;
  added_finding_ids: string[];
};

export type Stage = "pull" | "normalize" | "prioritize" | "remediate" | "sync" | "chase" | "report";

export type Envelope = {
  run_id: string;
  trigger: "schedule" | "manual" | "webhook";
  stage: Stage;
  generated_at: string;
  findings: NormalizedFinding[];
  groups: TeamGroup[];
  tickets: TicketSummary[];
  notes: string[];
};

export function emptyEnvelope(runId: string, trigger: Envelope["trigger"], stage: Stage): Envelope {
  return {
    run_id: runId,
    trigger,
    stage,
    generated_at: new Date().toISOString(),
    findings: [],
    groups: [],
    tickets: [],
    notes: [],
  };
}
