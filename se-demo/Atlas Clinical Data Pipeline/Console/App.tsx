// Atlas Data Operations Console.
//
// A single page over three of this workflow's routes: GET /atlas/data for
// everything shown, POST /atlas/run to trigger a pipeline run (with the chaos
// toggle), POST /atlas/action for the two human decisions (release or withhold a
// PHI quarantine, approve an AI-proposed remediation).
//
// One polling loop owns all refreshes: it waits for each request to settle
// before scheduling the next, polls fast while a run is in flight and slowly
// when the pipeline is idle, and cancels on unmount.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAOS_MODES,
  type ConsolePayload,
  approveRemediation,
  decideQuarantine,
  fetchConsole,
  relativeTime,
  triggerRun,
} from "./api";
import {
  Panel,
  QuarantinePanel,
  ReasonBreakdown,
  RunsTable,
  StatCard,
  StatusChip,
  TrendChart,
} from "./ui";

const IDLE_POLL_MS = 15000;
const ACTIVE_POLL_MS = 3000;

export default function App() {
  const [data, setData] = useState<ConsolePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chaos, setChaos] = useState<string>("none");
  const [notice, setNotice] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [busyQuarantineId, setBusyQuarantineId] = useState<number | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await fetchConsole(signal);
      if (!mounted.current) return payload;
      setData(payload);
      setError(null);
      return payload;
    } catch (err) {
      if (mounted.current && (err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err));
      }
      return null;
    }
  }, []);

  // Single refresh loop: one request at a time, cadence based on whether the
  // pipeline is currently working.
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const payload = await load(controller.signal);
      if (!mounted.current) return;
      const active = payload?.runs.some((run) => run.status === "running") ?? false;
      timer = setTimeout(tick, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    void tick();

    return () => {
      mounted.current = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const onTrigger = async () => {
    setTriggering(true);
    setNotice(null);
    try {
      const result = await triggerRun(chaos);
      setNotice(
        `Run ${result.runId} accepted for batch ${result.batchId}${
          chaos === "none" ? "" : ` with ${chaos.replace(/_/g, " ")} injected`
        }.`,
      );
      // Give Ingest a moment to open the run row, then refresh.
      setTimeout(() => void load(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriggering(false);
    }
  };

  const onDecide = async (id: number, decision: "approve" | "dismiss") => {
    setBusyQuarantineId(id);
    try {
      const result = await decideQuarantine(id, decision);
      setNotice(`Quarantine ${id} ${result.status} by ${result.decidedBy}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyQuarantineId(null);
    }
  };

  const onApproveRemediation = async (runId: string) => {
    setBusyRunId(runId);
    try {
      const result = await approveRemediation(runId);
      setNotice(
        `Remediation approved by ${result.approvedBy}: ${result.applied.source}.${result.applied.fromField} → ${result.applied.toField}. ${result.effect}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyRunId(null);
    }
  };

  const health = data?.health;
  const latestScore = health?.qualityTrend.at(-1)?.score ?? null;
  const previousScore = health?.qualityTrend.at(-2)?.score ?? null;
  const delta = latestScore !== null && previousScore !== null ? latestScore - previousScore : null;

  return (
    <div className="min-h-screen bg-navy-950 text-white">
      <title>Atlas — Data Operations Console</title>
      <header className="grid-veil border-b border-white/10 bg-navy-900">
        <div className="mx-auto max-w-[1600px] px-6 py-6 lg:px-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="label text-accent-400">Atlas Pharma Intelligence</div>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Data Operations Console
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-fog">
                Clinical trial and drug-pricing feeds from three partner sources, normalized to the
                canonical schema, validated, PHI-screened and published for API delivery.
              </p>
            </div>

            {/* Run control, chaos toggle exposed for demonstrations. */}
            <div className="w-full max-w-md border border-white/10 bg-navy-800/70 p-4">
              <div className="label text-slate-fog">Run pipeline</div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <select
                  value={chaos}
                  onChange={(event) => setChaos(event.target.value)}
                  className="min-w-0 flex-1 border border-white/15 bg-navy-950 px-3 py-2 text-xs text-white outline-none focus:border-accent-500"
                >
                  {CHAOS_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onTrigger}
                  disabled={triggering}
                  className={`shrink-0 px-4 py-2 text-xs font-semibold tracking-wide transition-colors disabled:opacity-50 ${
                    chaos === "none"
                      ? "bg-accent-500 text-navy-950 hover:bg-accent-400"
                      : "border border-degraded bg-degraded/15 text-degraded hover:bg-degraded hover:text-navy-950"
                  }`}
                >
                  {triggering ? "Dispatching…" : chaos === "none" ? "Run clean batch" : "Run with fault"}
                </button>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-fog">
                Runs are idempotent on batch id. Ingest retries a failing source three times with
                exponential backoff before declaring an outage.
              </p>
            </div>
          </div>

          {/* Health headline */}
          <div className="mt-8 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Last run"
              value={<StatusChip status={health?.lastRunStatus ?? "none"} size="lg" />}
              detail={
                health?.lastRunId
                  ? `${health.lastRunId} · ${relativeTime(health.lastRunAt)}`
                  : "waiting for the first run"
              }
            />
            <StatCard
              label="Data quality score"
              value={latestScore === null ? "—" : latestScore.toFixed(1)}
              detail={
                delta === null
                  ? "no prior scored run"
                  : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)} vs previous run`
              }
            />
            <StatCard
              label="Records published · 24 h"
              value={health?.publishedLast24h ?? 0}
              detail={`${health?.totalPublished ?? 0} in the canonical store`}
            />
            <StatCard
              label="Open quarantines"
              value={health?.openQuarantines ?? 0}
              detail="PHI findings awaiting human review"
            />
          </div>

          {notice ? (
            <div className="mt-4 border border-accent-500/40 bg-accent-500/10 px-4 py-3 text-xs text-accent-400">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div className="mt-4 border border-failure/50 bg-failure/10 px-4 py-3 text-xs text-failure">
              {error}
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <Panel
              title="Recent runs"
              aside={
                <span className="font-mono text-[11px] text-slate-fog">
                  {data ? `updated ${relativeTime(data.generatedAt)}` : "loading…"}
                </span>
              }
            >
              <p className="mb-4 text-xs text-slate-fog">
                Select a run to expand its per-step timeline, structured log lines, failure payload
                and AI triage note.
              </p>
              <RunsTable
                runs={data?.runs ?? []}
                remediations={data?.remediations ?? []}
                onApproveRemediation={onApproveRemediation}
                busyRunId={busyRunId}
              />
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel title="Data quality">
              <TrendChart points={health?.qualityTrend ?? []} />
              <p className="mt-3 font-mono text-[10px] text-slate-fog">
                quality score, last {health?.qualityTrend.length ?? 0} scored runs
              </p>
              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="label mb-4 text-slate-fog">Rejection reasons</div>
                <ReasonBreakdown reasons={data?.rejectionBreakdown ?? []} />
              </div>
            </Panel>

            <Panel
              title="Quarantine"
              aside={
                <span className="font-mono text-[11px] text-degraded">
                  {health?.openQuarantines ?? 0} open
                </span>
              }
            >
              <QuarantinePanel
                items={data?.quarantine ?? []}
                onDecide={onDecide}
                busyId={busyQuarantineId}
              />
            </Panel>

            {data?.remediations.length ? (
              <Panel title="Approved remediations">
                <ul className="space-y-3">
                  {data.remediations.map((item) => (
                    <li key={`${item.source}-${item.fromField}`} className="font-mono text-[11px]">
                      <div className="text-white/85">
                        {item.source}.{item.fromField} → {item.toField}
                      </div>
                      <div className="text-slate-fog">
                        {item.approvedBy} · {relativeTime(item.approvedAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>
        </div>
      </main>

      <footer className="border-t border-white/10 px-6 py-6 lg:px-10">
        <p className="mx-auto max-w-[1600px] font-mono text-[10px] text-slate-fog">
          Atlas Clinical Data Pipeline · all partner feeds simulated · no patient-level data is ever
          published
        </p>
      </footer>
    </div>
  );
}
