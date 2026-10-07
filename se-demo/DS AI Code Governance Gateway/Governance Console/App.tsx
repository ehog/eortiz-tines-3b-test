import { useEffect, useMemo, useState } from "react";
import {
  APPROVED_STATES, fetchData, postDecision, kpis, trend, breakdown, fmtDateTime, fmtDuration,
  severityRank, toCsv, downloadCsv,
  type GovernanceData, type Submission, type Finding,
} from "./data";

const NAVY = "#002E5D";
const TEAL = "#00A3C7";
const GREEN = "#1E8E5A";
const AMBER = "#C77700";
const RED = "#C0392B";

const TABS = ["Overview", "Review Queue", "Model Policy", "Audit Log"] as const;
type Tab = (typeof TABS)[number];

const statusStyle: Record<string, { label: string; color: string; bg: string }> = {
  deployed: { label: "Deployed", color: GREEN, bg: "#E8F5EE" },
  approved: { label: "Approved", color: GREEN, bg: "#E8F5EE" },
  "auto-approved": { label: "Auto-approved", color: GREEN, bg: "#E8F5EE" },
  pending: { label: "Needs review", color: AMBER, bg: "#FDF3E3" },
  "changes-requested": { label: "Changes requested", color: AMBER, bg: "#FDF3E3" },
  blocked: { label: "Blocked", color: RED, bg: "#FBEAE8" },
  rejected: { label: "Rejected", color: RED, bg: "#FBEAE8" },
};

const severityStyle: Record<string, { color: string; bg: string }> = {
  critical: { color: RED, bg: "#FBEAE8" },
  high: { color: "#A8431F", bg: "#FBEEE7" },
  medium: { color: AMBER, bg: "#FDF3E3" },
  low: { color: "#4A5A67", bg: "#F5F7F9" },
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8496A3]">{children}</div>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[4px] border border-[#D9E1E8] bg-white shadow-[0_1px_2px_rgba(0,46,93,0.05)] ${className}`}>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = statusStyle[status] ?? { label: status, color: "#4A5A67", bg: "#F5F7F9" };
  return (
    <span className="inline-block rounded-[2px] px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: s.color, backgroundColor: s.bg }}>
      {s.label}
    </span>
  );
}

function SeverityPill({ severity }: { severity: string }) {
  const s = severityStyle[severity] ?? severityStyle.low;
  return (
    <span className="inline-block rounded-[2px] px-[6px] py-[2px] text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: s.color, backgroundColor: s.bg }}>
      {severity}
    </span>
  );
}

function RiskBar({ score }: { score: number }) {
  const color = score > 70 ? RED : score >= 20 ? AMBER : GREEN;
  return (
    <div className="flex items-center gap-2">
      <span className="tabular w-8 text-right text-sm font-semibold" style={{ color }}>{score}</span>
      <div className="h-[4px] w-16 bg-[#EDF1F4]">
        <div className="h-full" style={{ width: `${Math.max(2, score)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="px-5 py-4">
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-2 text-[32px] font-light leading-none tabular" style={{ color: accent ?? NAVY }}>{value}</div>
      {sub ? <div className="mt-2 text-xs text-[#8496A3]">{sub}</div> : null}
    </Card>
  );
}

function TrendChart({ data }: { data: ReturnType<typeof trend> }) {
  const width = 720;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 26, left: 28 };
  const max = Math.max(4, ...data.map((d) => d.total));
  const bw = (width - pad.left - pad.right) / data.length;
  const y = (v: number) => pad.top + (height - pad.top - pad.bottom) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Submissions over the last 14 days">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="#EDF1F4" strokeWidth="1" />
          <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#8496A3">{t}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.left + i * bw + bw * 0.22;
        const w = bw * 0.56;
        const segments = [
          { v: d.approved, c: GREEN },
          { v: d.pending, c: AMBER },
          { v: d.blocked, c: RED },
        ];
        let acc = 0;
        return (
          <g key={d.day}>
            {segments.map((s, si) => {
              if (!s.v) return null;
              const yTop = y(acc + s.v);
              const h = y(acc) - yTop;
              acc += s.v;
              return <rect key={si} x={x} y={yTop} width={w} height={h} fill={s.c} />;
            })}
            {i % 2 === 0 ? (
              <text x={x + w / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="#8496A3">{d.label}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: ReturnType<typeof breakdown> }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card className="p-5">
      <MicroLabel>{title}</MicroLabel>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-[#EDF1F4] first:border-t-0">
              <td className="py-2 pr-3 text-[#33414C]">{r.name}</td>
              <td className="w-28 py-2">
                <div className="flex h-[6px] w-full overflow-hidden bg-[#F5F7F9]">
                  <div style={{ width: `${(r.approved / max) * 100}%`, backgroundColor: GREEN }} />
                  <div style={{ width: `${(r.pending / max) * 100}%`, backgroundColor: AMBER }} />
                  <div style={{ width: `${(r.blocked / max) * 100}%`, backgroundColor: RED }} />
                </div>
              </td>
              <td className="tabular w-10 py-2 text-right font-semibold text-[#002E5D]">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <div className="border-t border-[#EDF1F4] py-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <SeverityPill severity={f.severity} />
        <span className="text-[11px] font-semibold tracking-wide text-[#002E5D]">{f.rule_id}</span>
        <span className="text-sm text-[#33414C]">{f.title}</span>
        <span className="ml-auto text-[11px] text-[#8496A3]">line {f.line}</span>
      </div>
      <div className="mt-1 text-xs leading-relaxed text-[#5C6C79]">{f.detail}</div>
      <div className="mt-1 text-[11px] text-[#8496A3]">{f.category} · weight +{f.weight}</div>
      {f.evidence ? (
        <pre className="mt-2 overflow-x-auto border-l-2 border-[#D9E1E8] bg-[#F8FAFB] px-3 py-2 text-[11px] text-[#33414C]">{f.evidence}</pre>
      ) : null}
    </div>
  );
}

function DecisionDrawer({
  submission, onClose, onDecided,
}: { submission: Submission; onClose: () => void; onDecided: (msg: string) => void }) {
  const [reviewer, setReviewer] = useState("Claudia Reiss (Deputy CISO Office)");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const findings = [...submission.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  async function decide(decision: string) {
    if (!comment.trim()) {
      setError("A reviewer comment is required before recording a decision.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      await postDecision({ submission_id: submission.submission_id, decision, reviewer, comment: comment.trim() });
      onDecided(`${submission.submission_id} — ${decision === "approve" ? "approved and promoted" : decision === "reject" ? "rejected" : "changes requested"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "decision failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#002E5D]/25">
      <div className="h-full w-full max-w-[860px] overflow-y-auto border-l border-[#D9E1E8] bg-white">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#D9E1E8] bg-white px-7 py-5">
          <div>
            <MicroLabel>Submission</MicroLabel>
            <h2 className="mt-1 text-2xl font-light text-[#002E5D]">{submission.submission_id}</h2>
            <div className="mt-1 text-sm text-[#5C6C79]">{submission.description}</div>
          </div>
          <button onClick={onClose} className="rounded-[3px] border border-[#D9E1E8] px-3 py-1.5 text-sm text-[#4A5A67] hover:bg-[#F5F7F9]">Close</button>
        </div>

        <div className="space-y-6 px-7 py-6">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-3">
            {[
              ["Developer", `${submission.developer_name}`],
              ["Team / Region", `${submission.team} / ${submission.region}`],
              ["Source tool", submission.source_tool],
              ["Model used", submission.model_used],
              ["Artifact", `${submission.repo}@${submission.commit_sha}`],
              ["Branch", submission.branch],
              ["Pipeline", submission.bypass?.pipeline ?? "—"],
              ["Runner", submission.bypass?.runner ?? "—"],
              ["Received", fmtDateTime(submission.received_at)],
            ].map(([k, v]) => (
              <div key={k}>
                <MicroLabel>{k}</MicroLabel>
                <div className="mt-1 text-[#33414C]">{v}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-4">
              <MicroLabel>Risk score</MicroLabel>
              <div className="mt-2 flex items-center gap-3">
                <span className="tabular text-[28px] font-light" style={{ color: submission.risk_score > 70 ? RED : submission.risk_score >= 20 ? AMBER : GREEN }}>
                  {submission.risk_score}
                </span>
                <span className="text-xs uppercase tracking-wider text-[#8496A3]">{submission.scan_verdict}</span>
              </div>
            </Card>
            <Card className="p-4">
              <MicroLabel>Model policy</MicroLabel>
              <div className="mt-2 text-sm" style={{ color: submission.model_policy?.compliant ? GREEN : RED }}>
                {submission.model_policy?.compliant ? "Compliant" : "Violation"}
              </div>
              <div className="mt-1 text-xs text-[#5C6C79]">{submission.model_policy?.message}</div>
            </Card>
            <Card className="p-4">
              <MicroLabel>Origin</MicroLabel>
              <div className="mt-2 text-sm" style={{ color: submission.bypass?.bypass_attempt ? RED : GREEN }}>
                {submission.bypass?.bypass_attempt ? "Bypass attempt" : "Sanctioned pipeline"}
              </div>
              <div className="mt-1 text-xs text-[#5C6C79]">
                {submission.bypass?.bypass_attempt ? submission.bypass.reasons.map((r) => r.rule_id).join(", ") : "Repo, pipeline and runner all sanctioned"}
              </div>
            </Card>
          </div>

          {submission.bypass?.bypass_attempt ? (
            <Card className="border-l-[3px] p-5" style={{ borderLeftColor: RED }}>
              <MicroLabel>Bypass detection</MicroLabel>
              {submission.bypass.reasons.map((r) => (
                <div key={r.rule_id} className="mt-2 text-sm text-[#33414C]">
                  <span className="font-semibold" style={{ color: RED }}>{r.rule_id}</span> — {r.message}
                </div>
              ))}
            </Card>
          ) : null}

          {submission.model_policy && !submission.model_policy.compliant ? (
            <Card className="border-l-[3px] p-5" style={{ borderLeftColor: RED }}>
              <MicroLabel>Model policy verdict</MicroLabel>
              <div className="mt-2 text-sm text-[#33414C]">
                <span className="font-semibold" style={{ color: RED }}>{submission.model_policy.rule_id}</span> — {submission.model_policy.rule_fired}
              </div>
              <div className="mt-1 text-xs text-[#5C6C79]">Rationale: {submission.model_policy.rationale}</div>
              <div className="mt-1 text-xs text-[#5C6C79]">Permitted models: {submission.model_policy.allowed_models.join(", ") || "none"}</div>
            </Card>
          ) : null}

          <Card className="p-5">
            <MicroLabel>Policy findings ({findings.length})</MicroLabel>
            <div className="mt-2">
              {findings.length ? findings.map((f) => <FindingRow key={f.rule_id + f.line} f={f} />) : (
                <div className="py-3 text-sm text-[#5C6C79]">No findings — artifact passed every deterministic scan rule.</div>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <MicroLabel>Submitted artifact</MicroLabel>
            <pre className="mt-3 max-h-80 overflow-auto bg-[#F8FAFB] p-4 text-[12px] leading-relaxed text-[#26323B]">
              {submission.code_payload.split("\n").map((line, i) => {
                const flagged = findings.some((f) => f.line === i + 1);
                return (
                  <div key={i} className={flagged ? "bg-[#FBEAE8]" : ""}>
                    <span className="mr-3 inline-block w-6 select-none text-right text-[#A9B6C0]">{i + 1}</span>
                    {line || " "}
                  </div>
                );
              })}
            </pre>
          </Card>

          {submission.credentials ? (
            <Card className="p-5">
              <MicroLabel>Credential references</MicroLabel>
              <div className="mt-1 text-xs text-[#5C6C79]">{submission.credentials.note}</div>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {submission.credentials.references.map((c) => (
                    <tr key={c.name} className="border-t border-[#EDF1F4]">
                      <td className="py-2 pr-4 font-medium text-[#33414C]">{c.name}</td>
                      <td className="py-2 text-xs text-[#5C6C79]">{c.scope}</td>
                      <td className="py-2 text-right text-xs" style={{ color: GREEN }}>value never exposed</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          {submission.status === "pending" ? (
            <Card className="p-5">
              <MicroLabel>Human approval gate</MicroLabel>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="text-xs text-[#5C6C79]">Reviewer</span>
                  <input
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                    className="mt-1 w-full rounded-[3px] border border-[#D9E1E8] px-3 py-2 text-sm text-[#33414C] outline-none focus:border-[#00A3C7]"
                  />
                </label>
              </div>
              <label className="mt-3 block text-sm">
                <span className="text-xs text-[#5C6C79]">Reviewer comment (required — recorded in the audit ledger)</span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-[3px] border border-[#D9E1E8] px-3 py-2 text-sm text-[#33414C] outline-none focus:border-[#00A3C7]"
                  placeholder="Document the rationale for this decision…"
                />
              </label>
              {error ? <div className="mt-2 text-sm" style={{ color: RED }}>{error}</div> : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  data-decision="approve"
                  onClick={() => decide("approve")}
                  disabled={busy !== null}
                  className="rounded-[3px] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: TEAL }}
                >
                  {busy === "approve" ? "Approving…" : "Approve & deploy"}
                </button>
                <button
                  data-decision="request-changes"
                  onClick={() => decide("request-changes")}
                  disabled={busy !== null}
                  className="rounded-[3px] border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  style={{ borderColor: AMBER, color: AMBER }}
                >
                  {busy === "request-changes" ? "Sending…" : "Request changes"}
                </button>
                <button
                  data-decision="reject"
                  onClick={() => decide("reject")}
                  disabled={busy !== null}
                  className="rounded-[3px] border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  style={{ borderColor: RED, color: RED }}
                >
                  {busy === "reject" ? "Rejecting…" : "Reject"}
                </button>
              </div>
            </Card>
          ) : (
            <Card className="p-5">
              <MicroLabel>Disposition</MicroLabel>
              <div className="mt-2 flex items-center gap-3">
                <StatusPill status={submission.status} />
                <span className="text-sm text-[#5C6C79]">{submission.reviewer ?? "—"}</span>
                <span className="text-xs text-[#8496A3]">{fmtDateTime(submission.decided_at)}</span>
              </div>
              {submission.reviewer_comment ? <div className="mt-2 text-sm text-[#33414C]">{submission.reviewer_comment}</div> : null}
              {submission.deployment_id ? (
                <div className="mt-2 text-xs text-[#5C6C79]">Deployment {submission.deployment_id} · {fmtDateTime(submission.deployed_at)}</div>
              ) : null}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Overview({ data }: { data: GovernanceData }) {
  const k = kpis(data.submissions);
  const t = trend(data.submissions);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Submissions today" value={String(k.today)} sub={`${k.total} in the ledger`} />
        <KpiTile label="Auto-approved" value={String(k.autoApproved)} sub="Below risk threshold, no human touch" accent={GREEN} />
        <KpiTile label="Blocked" value={String(k.blocked)} sub="Never reached production" accent={RED} />
        <KpiTile label="Pending review" value={String(k.pending)} sub="Awaiting human approval" accent={AMBER} />
        <KpiTile label="Avg time to decision" value={fmtDuration(k.avgDecision)} sub={`Human reviews ${fmtDuration(k.avgHumanDecision)}`} />
        <KpiTile label="Bypass attempts" value={String(k.bypass)} sub="Ungoverned origin, blocked" accent={RED} />
      </div>

      <Card className="p-6">
        <div className="flex items-end justify-between">
          <div>
            <MicroLabel>Last 14 days</MicroLabel>
            <h3 className="mt-1 text-xl font-light text-[#002E5D]">Submissions by disposition</h3>
          </div>
          <div className="flex gap-4 text-xs text-[#5C6C79]">
            {[["Approved", GREEN], ["Needs review", AMBER], ["Blocked", RED]].map(([l, c]) => (
              <span key={l} className="flex items-center gap-2">
                <span className="inline-block h-[8px] w-[8px]" style={{ backgroundColor: c as string }} />{l}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <TrendChart data={t} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <BreakdownTable title="By team" rows={breakdown(data.submissions, "team")} />
        <BreakdownTable title="By region" rows={breakdown(data.submissions, "region")} />
        <BreakdownTable title="By source tool" rows={breakdown(data.submissions, "source_tool")} />
        <BreakdownTable title="By model" rows={breakdown(data.submissions, "model_used")} />
      </div>

      <Card className="p-6">
        <MicroLabel>Security events</MicroLabel>
        <h3 className="mt-1 text-xl font-light text-[#002E5D]">Raised by the gateway</h3>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-[#D9E1E8] text-left text-[11px] uppercase tracking-[0.12em] text-[#8496A3]">
              <th className="pb-2 font-semibold">Time</th>
              <th className="pb-2 font-semibold">Severity</th>
              <th className="pb-2 font-semibold">Kind</th>
              <th className="pb-2 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.security_events.slice(0, 8).map((e) => (
              <tr key={e.id} className="border-b border-[#EDF1F4] odd:bg-[#FAFCFD]">
                <td className="py-2 pr-4 whitespace-nowrap text-[#5C6C79]">{fmtDateTime(e.ts)}</td>
                <td className="py-2 pr-4"><SeverityPill severity={e.severity} /></td>
                <td className="py-2 pr-4 text-[#33414C]">{e.kind}</td>
                <td className="py-2 text-[#33414C]">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ReviewQueue({ data, onOpen }: { data: GovernanceData; onOpen: (s: Submission) => void }) {
  const pending = data.submissions.filter((s) => s.status === "pending");
  const recent = data.submissions.filter((s) => s.status !== "pending").slice(0, 12);

  const row = (s: Submission) => (
    <tr key={s.submission_id} onClick={() => onOpen(s)} className="cursor-pointer border-b border-[#EDF1F4] odd:bg-[#FAFCFD] hover:bg-[#F0F8FA]">
      <td className="py-3 pr-4 whitespace-nowrap font-medium text-[#002E5D]">{s.submission_id}</td>
      <td className="py-3 pr-4"><RiskBar score={s.risk_score} /></td>
      <td className="py-3 pr-4 text-[#33414C]">{s.team}</td>
      <td className="py-3 pr-4 text-[#33414C]">{s.region}</td>
      <td className="py-3 pr-4 text-[#33414C]">{s.model_used}</td>
      <td className="py-3 pr-4 text-[#33414C]">{s.source_tool}</td>
      <td className="py-3 pr-4 text-[#5C6C79]">{s.developer_name}</td>
      <td className="py-3 pr-4">
        <div className="flex gap-1">
          {s.bypass?.bypass_attempt ? <span className="text-[11px] font-semibold" style={{ color: RED }}>BYPASS</span> : null}
          {s.model_policy && !s.model_policy.compliant ? <span className="text-[11px] font-semibold" style={{ color: RED }}>MODEL</span> : null}
        </div>
      </td>
      <td className="py-3 pr-4 whitespace-nowrap text-[#5C6C79]">{fmtDateTime(s.received_at)}</td>
      <td className="py-3"><StatusPill status={s.status} /></td>
    </tr>
  );

  const head = (
    <thead>
      <tr className="border-b border-[#D9E1E8] text-left text-[11px] uppercase tracking-[0.12em] text-[#8496A3]">
        {["Submission", "Risk", "Team", "Region", "Model", "Source tool", "Developer", "Flags", "Received", "Status"].map((h) => (
          <th key={h} className="pb-2 pr-4 font-semibold">{h}</th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <MicroLabel>Human approval gate</MicroLabel>
        <h3 className="mt-1 text-xl font-light text-[#002E5D]">Pending submissions ({pending.length})</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            {head}
            <tbody>{pending.length ? pending.map(row) : (
              <tr><td colSpan={10} className="py-6 text-center text-sm text-[#8496A3]">Queue is clear.</td></tr>
            )}</tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <MicroLabel>Recently decided</MicroLabel>
        <h3 className="mt-1 text-xl font-light text-[#002E5D]">Last 12 dispositions</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            {head}
            <tbody>{recent.map(row)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ModelPolicyView({ data }: { data: GovernanceData }) {
  const { policy } = data;
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-end justify-between">
          <div>
            <MicroLabel>Configuration, not code</MicroLabel>
            <h3 className="mt-1 text-xl font-light text-[#002E5D]">Approved model matrix</h3>
          </div>
          <div className="text-xs text-[#8496A3]">Policy version {policy.version}</div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-[#8496A3]">
                <th className="border-b border-[#D9E1E8] pb-2 pr-4 font-semibold">Team</th>
                <th className="border-b border-[#D9E1E8] pb-2 pr-4 font-semibold">Region</th>
                <th className="border-b border-[#D9E1E8] pb-2 pr-4 font-semibold">Rule</th>
                {policy.models.map((m) => (
                  <th key={m} className="border-b border-[#D9E1E8] pb-2 pr-4 text-center font-semibold">{m}</th>
                ))}
                <th className="border-b border-[#D9E1E8] pb-2 font-semibold">Rationale</th>
              </tr>
            </thead>
            <tbody>
              {policy.rules.map((r) => (
                <tr key={r.id} className="border-b border-[#EDF1F4] odd:bg-[#FAFCFD]">
                  <td className="py-2 pr-4 text-[#33414C]">{r.team}</td>
                  <td className="py-2 pr-4 text-[#33414C]">{r.region}</td>
                  <td className="py-2 pr-4 font-medium text-[#002E5D]">{r.id}</td>
                  {policy.models.map((m) => (
                    <td key={m} className="py-2 pr-4 text-center">
                      {r.allowed.includes(m)
                        ? <span className="text-sm font-semibold" style={{ color: GREEN }}>allowed</span>
                        : <span className="text-sm" style={{ color: RED }}>denied</span>}
                    </td>
                  ))}
                  <td className="py-2 text-xs text-[#5C6C79]">{r.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          ["Sanctioned repositories", policy.sanctioned_repos],
          ["Sanctioned pipelines", policy.sanctioned_pipelines],
          ["Sanctioned runners", policy.sanctioned_runners],
        ].map(([title, items]) => (
          <Card key={title as string} className="p-5">
            <MicroLabel>{title as string}</MicroLabel>
            <ul className="mt-3 space-y-2 text-sm text-[#33414C]">
              {(items as string[]).map((i) => (
                <li key={i} className="border-t border-[#EDF1F4] pt-2 first:border-t-0 first:pt-0">{i}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AuditLog({ data }: { data: GovernanceData }) {
  const [q, setQ] = useState("");
  const [disposition, setDisposition] = useState("all");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.audit.filter((a) => {
      if (disposition !== "all" && a.disposition !== disposition) return false;
      if (!needle) return true;
      return [a.submission_id, a.actor, a.action, a.comment, a.policies_fired.join(" ")]
        .join(" ").toLowerCase().includes(needle);
    });
  }, [data.audit, q, disposition]);

  const dispositions = useMemo(() => ["all", ...new Set(data.audit.map((a) => a.disposition).filter(Boolean))], [data.audit]);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <MicroLabel>Immutable ledger</MicroLabel>
          <h3 className="mt-1 text-xl font-light text-[#002E5D]">Audit log ({rows.length} of {data.audit.length})</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by submission, actor, rule…"
            className="w-64 rounded-[3px] border border-[#D9E1E8] px-3 py-2 text-sm text-[#33414C] outline-none focus:border-[#00A3C7]"
          />
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
            className="rounded-[3px] border border-[#D9E1E8] bg-white px-3 py-2 text-sm text-[#33414C] outline-none focus:border-[#00A3C7]"
          >
            {dispositions.map((d) => <option key={d} value={d}>{d === "all" ? "All dispositions" : d}</option>)}
          </select>
          <button
            onClick={() => downloadCsv(
              "ds-ai-governance-audit.csv",
              toCsv(rows.map((a) => ({
                timestamp: a.ts, submission_id: a.submission_id, actor: a.actor, action: a.action,
                disposition: a.disposition, policies_fired: a.policies_fired.join(" "), comment: a.comment,
                deployment_id: a.detail?.deployment_id ?? "", risk_score: a.detail?.risk_score ?? "",
              }))),
            )}
            className="rounded-[3px] px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: NAVY }}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#D9E1E8] text-left text-[11px] uppercase tracking-[0.12em] text-[#8496A3]">
              {["Timestamp", "Submission", "Actor", "Action", "Disposition", "Policies fired", "Comment"].map((h) => (
                <th key={h} className="pb-2 pr-4 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 250).map((a) => (
              <tr key={a.id} className="border-b border-[#EDF1F4] odd:bg-[#FAFCFD]">
                <td className="py-2 pr-4 whitespace-nowrap text-[#5C6C79]">{fmtDateTime(a.ts)}</td>
                <td className="py-2 pr-4 whitespace-nowrap font-medium text-[#002E5D]">{a.submission_id}</td>
                <td className="py-2 pr-4 text-[#33414C]">{a.actor}</td>
                <td className="py-2 pr-4 text-[#33414C]">{a.action}</td>
                <td className="py-2 pr-4"><StatusPill status={a.disposition} /></td>
                <td className="py-2 pr-4 text-xs text-[#5C6C79]">{a.policies_fired.join(", ") || "none"}</td>
                <td className="py-2 max-w-[380px] text-xs text-[#5C6C79]">{a.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [data, setData] = useState<GovernanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    try {
      setData(await fetchData());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load governance data");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedSubmission = data?.submissions.find((s) => s.submission_id === selected) ?? null;

  return (
    <div className="min-h-screen bg-[#F5F7F9] text-[#4A5A67]">
      <title>DS AI Governance Console — Dentsply Sirona</title>

      <header className="border-b border-[#D9E1E8] bg-white">
        <div className="mx-auto flex max-w-[1440px] items-baseline gap-4 px-8 pt-6 pb-4">
          <span className="text-[22px] font-semibold tracking-tight text-[#002E5D]">Dentsply Sirona</span>
          <span className="text-[15px] font-light text-[#8496A3]">AI Governance Console</span>
          <div className="ml-auto flex items-center gap-4 text-xs text-[#8496A3]">
            {data ? <span>Policy {data.policy.version}</span> : null}
            {data ? <span>Updated {fmtDateTime(data.generated_at)}</span> : null}
            <button onClick={load} className="rounded-[3px] border border-[#D9E1E8] px-3 py-1.5 text-[#4A5A67] hover:bg-[#F5F7F9]">Refresh</button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1440px] gap-8 px-8">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="relative pb-3 text-sm"
              style={{ color: tab === t ? NAVY : "#5C6C79", fontWeight: tab === t ? 600 : 400 }}
            >
              {t}
              {t === "Review Queue" && data?.submissions.some((s) => s.status === "pending") ? (
                <span className="ml-2 rounded-[2px] bg-[#FDF3E3] px-[6px] py-[2px] text-[11px] font-semibold" style={{ color: AMBER }}>
                  {data.submissions.filter((s) => s.status === "pending").length}
                </span>
              ) : null}
              {tab === t ? <span className="absolute inset-x-0 -bottom-[1px] h-[3px]" style={{ backgroundColor: TEAL }} /> : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1440px] px-8 py-8">
        <div className="mb-6">
          <MicroLabel>{tab === "Overview" ? "Enforcement posture" : tab === "Review Queue" ? "Deployment funnel" : tab === "Model Policy" ? "Policy configuration" : "Evidence"}</MicroLabel>
          <h1 className="mt-2 text-[30px] font-light leading-tight text-[#002E5D]">
            {tab === "Overview" && "AI-generated code entering production"}
            {tab === "Review Queue" && "Submissions awaiting human approval"}
            {tab === "Model Policy" && "Per-team and per-region model restrictions"}
            {tab === "Audit Log" && "Every decision, permanently recorded"}
          </h1>
        </div>

        {error ? (
          <Card className="border-l-[3px] p-5" style={{ borderLeftColor: RED }}>
            <div className="text-sm" style={{ color: RED }}>{error}</div>
            <div className="mt-1 text-xs text-[#5C6C79]">Run the “Seed Demo Data” step, then refresh.</div>
          </Card>
        ) : !data ? (
          <div className="text-sm text-[#8496A3]">Loading governance ledger…</div>
        ) : !data.seeded ? (
          <Card className="p-6">
            <div className="text-sm text-[#33414C]">The governance ledger is empty. Run the “Seed Demo Data” step to load demo history.</div>
          </Card>
        ) : (
          <>
            {tab === "Overview" && <Overview data={data} />}
            {tab === "Review Queue" && <ReviewQueue data={data} onOpen={(s) => setSelected(s.submission_id)} />}
            {tab === "Model Policy" && <ModelPolicyView data={data} />}
            {tab === "Audit Log" && <AuditLog data={data} />}
          </>
        )}
      </main>

      {selectedSubmission ? (
        <DecisionDrawer
          submission={selectedSubmission}
          onClose={() => setSelected(null)}
          onDecided={async (msg) => {
            setSelected(null);
            setToast(msg);
            await load();
            setTimeout(() => setToast(null), 6000);
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-[4px] border border-[#D9E1E8] bg-white px-5 py-3 text-sm shadow-[0_4px_12px_rgba(0,46,93,0.12)]">
          <span className="font-semibold" style={{ color: GREEN }}>Decision recorded</span>
          <span className="ml-2 text-[#33414C]">{toast}</span>
        </div>
      ) : null}

      <footer className="mx-auto max-w-[1440px] px-8 pb-10 text-xs text-[#8496A3]">
        Deterministic demo environment · external systems simulated · no production credentials in scope
      </footer>
    </div>
  );
}
