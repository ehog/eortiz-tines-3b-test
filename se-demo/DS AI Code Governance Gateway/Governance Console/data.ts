export type Finding = {
  rule_id: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  line: number;
  evidence: string;
  weight: number;
};

export type ModelPolicy = {
  policy_version?: string;
  compliant: boolean;
  rule_id: string | null;
  rule_fired: string | null;
  allowed_models: string[];
  model_used: string;
  message: string;
  rationale: string | null;
};

export type Submission = {
  submission_id: string;
  received_at: string;
  developer_name: string;
  developer_email: string;
  team: string;
  region: string;
  source_tool: string;
  model_used: string;
  repo: string;
  branch: string;
  commit_sha: string;
  description: string;
  code_payload: string;
  risk_score: number;
  scan_verdict: string;
  findings: Finding[];
  model_policy: ModelPolicy;
  bypass: { bypass_attempt: boolean; reasons: { rule_id: string; message: string }[]; pipeline?: string; runner?: string; repo_sanctioned?: boolean; pipeline_sanctioned?: boolean; runner_sanctioned?: boolean };
  credentials: { note: string; references: { name: string; scope: string; purpose?: string }[] } | null;
  status: string;
  reviewer: string | null;
  reviewer_comment: string | null;
  decided_at: string | null;
  decision_seconds: number | null;
  deployment_id: string | null;
  deployed_at: string | null;
};

export type AuditRecord = {
  id: number;
  ts: string;
  submission_id: string;
  actor: string;
  action: string;
  policies_fired: string[];
  comment: string;
  disposition: string;
  detail: Record<string, any>;
};

export type SecurityEvent = { id: number; ts: string; submission_id: string; severity: string; kind: string; message: string };

export type PolicyBundle = {
  version: string;
  models: string[];
  teams: string[];
  regions: string[];
  rules: { id: string; team: string; region: string; allowed: string[]; rationale: string }[];
  sanctioned_repos: string[];
  sanctioned_pipelines: string[];
  sanctioned_runners: string[];
};

export type GovernanceData = {
  generated_at: string;
  seeded: boolean;
  submissions: Submission[];
  audit: AuditRecord[];
  security_events: SecurityEvent[];
  policy: PolicyBundle;
};

const routePath: string = (window as any).__ROUTE_PATH__ ?? "";
const base = routePath.endsWith("/ds-console") ? routePath.slice(0, -"/ds-console".length) : "";

export const API_URL = `${base}/ds-governance-api`;
export const DECISION_URL = `${base}/ds-decision`;

export async function fetchData(): Promise<GovernanceData> {
  const res = await fetch(API_URL, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`governance API returned ${res.status}`);
  return res.json();
}

export async function postDecision(body: { submission_id: string; decision: string; reviewer: string; comment: string }) {
  const res = await fetch(DECISION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) throw new Error(parsed?.error ?? `decision endpoint returned ${res.status}`);
  return parsed;
}

export const APPROVED_STATES = ["approved", "auto-approved", "deployed"];

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function severityRank(s: string) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[s] ?? 4;
}

export function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function kpis(subs: Submission[]) {
  const today = subs.filter((s) => isToday(s.received_at));
  const decided = subs.filter((s) => s.decision_seconds !== null && s.decision_seconds !== undefined);
  const avg = decided.length ? decided.reduce((t, s) => t + (s.decision_seconds ?? 0), 0) / decided.length : null;
  const humanDecided = decided.filter((s) => s.reviewer && !s.reviewer.startsWith("3b-gateway"));
  const avgHuman = humanDecided.length ? humanDecided.reduce((t, s) => t + (s.decision_seconds ?? 0), 0) / humanDecided.length : null;
  return {
    today: today.length,
    total: subs.length,
    autoApproved: subs.filter((s) => s.reviewer?.startsWith("3b-gateway") && APPROVED_STATES.includes(s.status)).length,
    blocked: subs.filter((s) => s.status === "blocked").length,
    pending: subs.filter((s) => s.status === "pending").length,
    deployed: subs.filter((s) => s.status === "deployed").length,
    rejected: subs.filter((s) => s.status === "rejected" || s.status === "changes-requested").length,
    bypass: subs.filter((s) => s.bypass?.bypass_attempt).length,
    modelViolations: subs.filter((s) => s.model_policy && s.model_policy.compliant === false).length,
    avgDecision: avg,
    avgHumanDecision: avgHuman,
  };
}

export function trend(subs: Submission[], days = 14) {
  const buckets: { day: string; label: string; total: number; blocked: number; approved: number; pending: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    buckets.push({
      day: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      total: 0,
      blocked: 0,
      approved: 0,
      pending: 0,
    });
  }
  const index = new Map(buckets.map((b) => [b.day, b]));
  for (const s of subs) {
    const key = new Date(s.received_at).toISOString().slice(0, 10);
    const b = index.get(key);
    if (!b) continue;
    b.total += 1;
    if (s.status === "blocked") b.blocked += 1;
    else if (s.status === "pending") b.pending += 1;
    else if (APPROVED_STATES.includes(s.status)) b.approved += 1;
  }
  return buckets;
}

export function breakdown(subs: Submission[], key: keyof Submission) {
  const map = new Map<string, { name: string; total: number; blocked: number; approved: number; pending: number }>();
  for (const s of subs) {
    const name = String(s[key] ?? "unknown");
    const row = map.get(name) ?? { name, total: 0, blocked: 0, approved: 0, pending: 0 };
    row.total += 1;
    if (s.status === "blocked") row.blocked += 1;
    else if (s.status === "pending") row.pending += 1;
    else if (APPROVED_STATES.includes(s.status)) row.approved += 1;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
