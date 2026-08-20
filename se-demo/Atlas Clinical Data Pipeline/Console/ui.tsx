// Presentational pieces of the Data Operations Console. Kept separate from
// App.tsx so the page shell stays readable: everything here is pure rendering
// plus the two human-in-the-loop action buttons.

import { Fragment, useState } from "react";
import {
  type ConsolePayload,
  type LogLine,
  type QuarantineItem,
  type Run,
  type RunStatus,
  type Triage,
  formatDuration,
  formatTime,
} from "./api";

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  ok: { dot: "bg-accent-500", text: "text-accent-500", label: "Healthy" },
  degraded: { dot: "bg-degraded", text: "text-degraded", label: "Degraded" },
  failed: { dot: "bg-failure", text: "text-failure", label: "Failed" },
  stalled: { dot: "bg-failure", text: "text-failure", label: "Stalled" },
  running: { dot: "bg-accent-blue animate-pulse", text: "text-accent-blue", label: "Running" },
  none: { dot: "bg-navy-600", text: "text-slate-fog", label: "No runs" },
};

export function StatusChip({ status, size = "sm" }: { status: RunStatus | "none"; size?: "sm" | "lg" }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.none;
  return (
    <span className={`inline-flex items-center gap-2 ${size === "lg" ? "text-base" : "text-xs"}`}>
      <span className={`inline-block rounded-full ${style.dot} ${size === "lg" ? "h-2.5 w-2.5" : "h-1.5 w-1.5"}`} />
      <span className={`${style.text} font-medium tracking-wide`}>{style.label}</span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="border border-white/10 bg-navy-800/60 px-5 py-4">
      <div className="label text-slate-fog">{label}</div>
      <div className="mt-2 font-display text-3xl leading-none text-white tabular">{value}</div>
      {detail ? <div className="mt-2 text-xs text-slate-fog">{detail}</div> : null}
      {children}
    </div>
  );
}

/** Quality score over the last N runs. Monochrome within the accent family. */
export function TrendChart({ points }: { points: { runId: string; score: number; status: RunStatus }[] }) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-fog">No scored runs yet.</p>;
  }
  return (
    <div className="flex h-32 items-end gap-1.5">
      {points.map((point) => {
        const height = Math.max(4, (point.score / 100) * 100);
        const tone =
          point.status === "degraded"
            ? "bg-degraded/80"
            : point.status === "failed" || point.status === "stalled"
              ? "bg-failure/80"
              : "bg-accent-500/80";
        return (
          <div key={point.runId} className="group relative flex-1">
            <div
              className={`${tone} w-full transition-all duration-500 group-hover:opacity-100 opacity-80`}
              style={{ height: `${height * 1.2}px` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap border border-white/15 bg-navy-950 px-2 py-1 font-mono text-[10px] text-white group-hover:block">
              {point.runId} · {point.score.toFixed(1)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ReasonBreakdown({ reasons }: { reasons: { reasonCode: string; count: number }[] }) {
  const max = Math.max(1, ...reasons.map((r) => r.count));
  if (reasons.length === 0) {
    return <p className="text-sm text-slate-fog">No records have been rejected.</p>;
  }
  return (
    <ul className="space-y-3">
      {reasons.map((reason) => (
        <li key={reason.reasonCode}>
          <div className="flex items-baseline justify-between font-mono text-[11px] text-white/80">
            <span>{reason.reasonCode}</span>
            <span className="tabular text-slate-fog">{reason.count}</span>
          </div>
          <div className="mt-1.5 h-1 w-full bg-white/8">
            <div
              className="h-full bg-accent-blue/70 transition-all duration-700"
              style={{ width: `${(reason.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function LevelBadge({ level }: { level: LogLine["level"] }) {
  const tone =
    level === "error" ? "text-failure" : level === "warn" ? "text-degraded" : "text-accent-500";
  return <span className={`${tone} font-mono text-[10px] uppercase`}>{level}</span>;
}

/** The AI triage note, plus the operator approval for its proposed fix. */
export function TriageCard({
  triage,
  runId,
  onApprove,
  approved,
  busy,
}: {
  triage: Triage;
  runId: string;
  onApprove: (runId: string) => void;
  approved: boolean;
  busy: boolean;
}) {
  return (
    <div className="border border-accent-blue/30 bg-accent-blue/5 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="label text-accent-400">AI triage</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-white">
          {triage.rootCause.replace(/_/g, " ")}
        </span>
        <span className="font-mono text-[11px] text-slate-fog">confidence {triage.confidence}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-fog">{triage.model}</span>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/85">{triage.note}</p>
      {triage.owner ? (
        <p className="mt-2 font-mono text-[11px] text-slate-fog">owner · {triage.owner}</p>
      ) : null}

      {triage.proposedFix ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="label text-slate-fog">Proposed remediation</div>
          <p className="mt-2 text-sm text-white/80">{triage.proposedFix.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="border border-white/15 px-2 py-1 font-mono text-[11px] text-white/80">
              {triage.proposedFix.source}.{triage.proposedFix.fromField} → {triage.proposedFix.toField}
            </code>
            {approved ? (
              <span className="font-mono text-[11px] text-accent-500">approved · active from next run</span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onApprove(runId)}
                className="border border-accent-500 px-3 py-1.5 text-xs font-medium tracking-wide text-accent-400 transition-colors hover:bg-accent-500 hover:text-navy-950 disabled:opacity-40"
              >
                {busy ? "Applying…" : "Approve remediation"}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ErrorPayload({ run }: { run: Run }) {
  if (!run.error) return null;
  const rows: [string, string][] = [
    ["Source", run.error.source],
    ["Field", run.error.field ?? "—"],
    ["Record", run.error.recordId ?? "—"],
    ["Owner", run.error.owner],
    ["Detail", run.error.message],
    ["Changed vs last good run", run.error.changedVsLastGoodRun ?? "—"],
  ];
  return (
    <div className="border border-failure/40 bg-failure/5 p-4">
      <div className="label text-failure">Failure payload</div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        {rows.map(([key, value]) => (
          <div key={key} className="sm:col-span-2 sm:grid sm:grid-cols-subgrid">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-slate-fog">{key}</dt>
            <dd className="text-sm text-white/85">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StepTimeline({ run }: { run: Run }) {
  const total = Math.max(1, ...run.timeline.map((t) => t.durationMs));
  return (
    <div>
      <div className="label text-slate-fog">Step timeline</div>
      <ul className="mt-3 space-y-2">
        {run.timeline.map((step) => (
          <li key={step.step} className="flex items-center gap-3">
            <span className="w-28 shrink-0 font-mono text-[11px] text-white/70">{step.step}</span>
            <span className="h-1.5 flex-1 bg-white/8">
              <span
                className="block h-full bg-accent-500/60"
                style={{ width: `${Math.max(3, (step.durationMs / total) * 100)}%` }}
              />
            </span>
            <span className="tabular w-16 shrink-0 text-right font-mono text-[11px] text-slate-fog">
              {formatDuration(step.durationMs)}
            </span>
          </li>
        ))}
        {run.timeline.length === 0 ? (
          <li className="text-sm text-slate-fog">No step logs recorded for this run.</li>
        ) : null}
      </ul>
    </div>
  );
}

function LogStream({ logs }: { logs: LogLine[] }) {
  return (
    <div>
      <div className="label text-slate-fog">Structured logs</div>
      <div className="mt-3 max-h-72 overflow-auto border border-white/10 bg-navy-950">
        {logs.map((line, index) => (
          <div key={`${line.ts}-${index}`} className="flex gap-3 border-b border-white/5 px-3 py-2 last:border-0">
            <span className="w-20 shrink-0 font-mono text-[10px] text-slate-fog">
              {line.ts.slice(11, 23)}
            </span>
            <span className="w-24 shrink-0 font-mono text-[10px] text-white/60">{line.step}</span>
            <LevelBadge level={line.level} />
            <span className="min-w-0 flex-1 font-mono text-[11px] text-white/85">
              {line.message}
              {line.data ? (
                <span className="text-slate-fog"> {JSON.stringify(line.data)}</span>
              ) : null}
            </span>
          </div>
        ))}
        {logs.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-fog">No log lines stored for this run.</p>
        ) : null}
      </div>
    </div>
  );
}

export function RunsTable({
  runs,
  remediations,
  onApproveRemediation,
  busyRunId,
}: {
  runs: Run[];
  remediations: ConsolePayload["remediations"];
  onApproveRemediation: (runId: string) => void;
  busyRunId: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(runs.find((r) => r.status !== "ok")?.runId ?? null);

  return (
    <div className="overflow-hidden border border-white/10">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-white/10 bg-navy-800/60">
            {["Run", "Started", "Sources", "In / Out", "Rejected", "Quarantined", "Quality", "Duration", "Status"].map(
              (heading) => (
                <th key={heading} className="label px-4 py-3 font-medium text-slate-fog whitespace-nowrap">
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const isOpen = expanded === run.runId;
            const approved = remediations.some((r) => r.runId === run.runId);
            return (
              <Fragment key={run.runId}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : run.runId)}
                  className={`cursor-pointer border-b border-white/5 transition-colors ${
                    isOpen ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-white">{run.runId}</div>
                    <div className="font-mono text-[10px] text-slate-fog">{run.batchId}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/70 whitespace-nowrap">{formatTime(run.startedAt)}</td>
                  <td className="px-4 py-3 text-xs text-white/70">{run.sources.length} feeds</td>
                  <td className="tabular px-4 py-3 font-mono text-xs text-white/85">
                    {run.recordsIn} / {run.recordsOut}
                  </td>
                  <td className={`tabular px-4 py-3 font-mono text-xs ${run.rejected ? "text-degraded" : "text-white/50"}`}>
                    {run.rejected}
                  </td>
                  <td className={`tabular px-4 py-3 font-mono text-xs ${run.quarantined ? "text-accent-400" : "text-white/50"}`}>
                    {run.quarantined}
                  </td>
                  <td className="tabular px-4 py-3 font-mono text-xs text-white/85">
                    {run.qualityScore === null ? "—" : run.qualityScore.toFixed(1)}
                  </td>
                  <td className="tabular px-4 py-3 font-mono text-xs text-white/60">
                    {formatDuration(run.durationMs)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={run.status} />
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="border-b border-white/10 bg-navy-900/80">
                    <td colSpan={9} className="px-4 py-5">
                      <div className="space-y-5">
                        {run.error ? <ErrorPayload run={run} /> : null}
                        {run.triage ? (
                          <TriageCard
                            triage={run.triage}
                            runId={run.runId}
                            approved={approved}
                            busy={busyRunId === run.runId}
                            onApprove={onApproveRemediation}
                          />
                        ) : null}
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                          <StepTimeline run={run} />
                          <LogStream logs={run.logs} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {runs.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-fog">
                No runs recorded yet. Trigger one with the control above.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function QuarantinePanel({
  items,
  onDecide,
  busyId,
}: {
  items: QuarantineItem[];
  onDecide: (id: number, decision: "approve" | "dismiss") => void;
  busyId: number | null;
}) {
  const open = items.filter((item) => item.status === "open");
  const decided = items.filter((item) => item.status !== "open").slice(0, 6);

  return (
    <div className="space-y-4">
      {open.length === 0 ? (
        <p className="text-sm text-slate-fog">No open quarantines. Every published record cleared the PHI guard.</p>
      ) : null}
      <ul className="space-y-3">
        {open.map((item) => (
          <li key={item.id} className="border border-white/10 bg-navy-800/50 p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-degraded">{item.reasonCode}</span>
              <span className="ml-auto font-mono text-[10px] text-slate-fog">{item.source}</span>
            </div>
            <div className="mt-2 font-mono text-xs text-white">
              {item.trialId} · {item.ndc || "no NDC"}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-fog">{item.detail}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => onDecide(item.id, "approve")}
                className="border border-accent-500 px-3 py-1.5 text-[11px] font-medium tracking-wide text-accent-400 transition-colors hover:bg-accent-500 hover:text-navy-950 disabled:opacity-40"
              >
                Approve &amp; publish
              </button>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => onDecide(item.id, "dismiss")}
                className="border border-white/20 px-3 py-1.5 text-[11px] font-medium tracking-wide text-white/70 transition-colors hover:border-failure hover:text-failure disabled:opacity-40"
              >
                Keep withheld
              </button>
            </div>
          </li>
        ))}
      </ul>
      {decided.length ? (
        <div className="border-t border-white/10 pt-4">
          <div className="label text-slate-fog">Recent decisions</div>
          <ul className="mt-3 space-y-2">
            {decided.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
                <span className={item.status === "released" ? "text-accent-500" : "text-slate-fog"}>
                  {item.status}
                </span>
                <span className="text-white/70">{item.trialId}</span>
                <span className="text-slate-fog">{item.reasonCode}</span>
                <span className="ml-auto text-slate-fog">{item.decidedBy}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-white/10 bg-navy-900/60 p-5">
      <header className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-sm font-semibold tracking-[0.14em] text-white uppercase">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
