import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultChaos,
  fetchRun,
  fetchRuns,
  generateAlertId,
  resetDemo,
  resumeRun,
  startRun,
  STAGE_META,
  type ChaosConfig,
  type RunDetail,
} from "./data";
import {
  AuditTable,
  buildStageViews,
  ChaosPanel,
  GuardrailBanner,
  LogStream,
  RunList,
  RunStatusBadge,
  StageTimeline,
  StateCards,
} from "./components";

const REPLAY_SPEEDS = [
  { id: "1x", label: "1x", factor: 1 },
  { id: "4x", label: "4x", factor: 4 },
  { id: "instant", label: "Instant", factor: 0 },
];

export default function App() {
  const [alertId, setAlertId] = useState(generateAlertId);
  const [endpoint, setEndpoint] = useState("WS-FIN-0421");
  const [userEmail, setUserEmail] = useState("a.reyes@corp.example");
  const [severity, setSeverity] = useState("high");
  const [chaos, setChaos] = useState<ChaosConfig>(defaultChaos);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [clock, setClock] = useState(Number.POSITIVE_INFINITY);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("4x");
  const replayedRun = useRef<string | null>(null);

  const run = detail?.run ?? null;
  const attempts = detail?.attempts ?? [];
  const audit = detail?.audit ?? [];
  const stages = detail?.stages ?? [];
  const isRunning = run?.status === "running";
  const maxRel = useMemo(() => attempts.reduce((max, entry) => Math.max(max, entry.relMs), 0), [attempts]);

  const load = useCallback(
    async (runId: string | null) => {
      try {
        const data = runId ? await fetchRun(runId) : await fetchRuns();
        setDetail(data);
        setError(null);
        if (!runId && data.runs.length > 0 && !selectedRunId) setSelectedRunId(data.runs[0].runId);
      } catch (loadError) {
        setError((loadError as Error).message);
      }
    },
    [selectedRunId],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resumeTarget = params.get("resume");
    if (resumeTarget) {
      setSelectedRunId(resumeTarget);
      setNotice(`Opened from an alert link — run ${resumeTarget} is ready to resume from its failed step.`);
    }
    void load(resumeTarget);
  }, [load]);

  useEffect(() => {
    if (!selectedRunId) return;
    void load(selectedRunId);
  }, [selectedRunId, load]);

  // Poll while a run is executing; the orchestrator publishes its state when the step finishes.
  useEffect(() => {
    if (!selectedRunId) return;
    const pollNeeded = isRunning || busy !== null;
    if (!pollNeeded) return;
    const timer = setInterval(() => void load(selectedRunId), 1200);
    return () => clearInterval(timer);
  }, [selectedRunId, isRunning, busy, load]);

  // Auto-replay a finished run once, so the timeline animates instead of appearing complete.
  useEffect(() => {
    if (!run || isRunning || maxRel === 0) return;
    if (replayedRun.current === `${run.runId}:${run.updatedAt}`) return;
    replayedRun.current = `${run.runId}:${run.updatedAt}`;
    setClock(0);
    setPlaying(true);
  }, [run, isRunning, maxRel]);

  useEffect(() => {
    if (!playing) return;
    const factor = REPLAY_SPEEDS.find((option) => option.id === speed)?.factor ?? 1;
    if (factor === 0) {
      setClock(Number.POSITIVE_INFINITY);
      setPlaying(false);
      return;
    }
    const tick = 100;
    const timer = setInterval(() => {
      setClock((current) => {
        const next = (Number.isFinite(current) ? current : 0) + tick * factor;
        if (next >= maxRel + 400) {
          setPlaying(false);
          return Number.POSITIVE_INFINITY;
        }
        return next;
      });
    }, tick);
    return () => clearInterval(timer);
  }, [playing, speed, maxRel]);

  const effectiveClock = isRunning ? Number.POSITIVE_INFINITY : clock;
  const views = useMemo(() => buildStageViews(stages, attempts, effectiveClock), [stages, attempts, effectiveClock]);

  const onLaunch = async () => {
    setBusy("launch");
    setError(null);
    setNotice(null);
    try {
      const result = await startRun({ alertId, endpoint, userEmail, severity, chaos });
      setSelectedRunId(result.runId);
      setDetail(null);
      setClock(Number.POSITIVE_INFINITY);
      replayedRun.current = null;
      setNotice(`Run ${result.runId} started.`);
      await load(result.runId);
    } catch (launchError) {
      setError((launchError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onResume = async (clearChaos: boolean) => {
    if (!run) return;
    setBusy("resume");
    setError(null);
    try {
      const result = await resumeRun(run.runId, chaos, clearChaos);
      setNotice(
        `Resuming ${result.runId} at ${result.resumeFrom}. Skipped: ${result.skipping.join(", ") || "nothing"} (resume #${result.resumeCount}).`,
      );
      replayedRun.current = null;
      await load(run.runId);
    } catch (resumeError) {
      setError((resumeError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onReset = async () => {
    setBusy("reset");
    setError(null);
    try {
      const result = await resetDemo("all");
      setNotice(result.message);
      setSelectedRunId(null);
      setDetail(null);
      replayedRun.current = null;
      await load(null);
    } catch (resetError) {
      setError((resetError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resumeInfo = detail?.resume ?? null;
  const canResume = Boolean(run && run.status !== "contained" && run.status !== "running" && resumeInfo?.resumeFrom);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <title>Containment console</title>
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Containment with guardrails</h1>
            <p className="text-xs text-slate-400">
              Proofpoint → Zscaler → Defender → ServiceNow → isolate. Every call has its own deadline, bounded retries and a
              guardrail that refuses to leave partial containment.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load(selectedRunId)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={busy !== null}
              className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-400 disabled:opacity-40"
            >
              {busy === "reset" ? "Resetting…" : "Reset demo"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-5 px-6 py-6 xl:grid-cols-[360px_1fr]">
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-sm font-semibold text-slate-200">Launch containment</h2>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">Alert ID</span>
                <div className="mt-1 flex gap-2">
                  <input
                    value={alertId}
                    onChange={(event) => setAlertId(event.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setAlertId(generateAlertId())}
                    className="rounded-md border border-slate-700 px-2 text-xs text-slate-400 transition hover:text-slate-200"
                  >
                    New
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">Endpoint</span>
                <input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">User</span>
                <input
                  value={userEmail}
                  onChange={(event) => setUserEmail(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">Severity</span>
                <select
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </label>
              <button
                type="button"
                onClick={onLaunch}
                disabled={busy !== null}
                className="w-full rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-40"
              >
                {busy === "launch" ? "Starting…" : "Run containment"}
              </button>
            </div>
          </div>

          <ChaosPanel chaos={chaos} onChange={setChaos} disabled={busy !== null} />
          <RunList runs={detail?.runs ?? []} selected={selectedRunId} onSelect={(runId) => {
            replayedRun.current = null;
            setClock(Number.POSITIVE_INFINITY);
            setSelectedRunId(runId);
          }} />
        </section>

        <section className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
          ) : null}
          {notice ? (
            <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">{notice}</div>
          ) : null}

          {!run ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-6 py-16 text-center">
              <p className="text-sm text-slate-400">
                No run selected. Pick a chaos preset and press <span className="text-slate-200">Run containment</span> to drive the
                demo.
              </p>
              <div className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-2 text-[11px] text-slate-500">
                {STAGE_META.map((stage, index) => (
                  <span key={stage.key} className="rounded-md border border-slate-800 px-2 py-1">
                    {index + 1}. {stage.label} · {stage.timeout} · {stage.retries}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <RunStatusBadge status={run.status} />
                      <span className="font-mono text-xs text-slate-400">{run.runId}</span>
                      {run.resumeCount > 0 ? (
                        <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">resume #{run.resumeCount}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-slate-300">
                      {run.endpoint} · {run.alertId} · {run.severity} · {run.userEmail}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isRunning ? (
                      <span className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
                        containment executing…
                      </span>
                    ) : (
                      <>
                        <span className="text-[11px] uppercase tracking-wider text-slate-500">Replay</span>
                        <button
                          type="button"
                          onClick={() => {
                            setClock(0);
                            setPlaying(true);
                          }}
                          className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-sky-500/60"
                        >
                          {playing ? "Restart" : "Play"}
                        </button>
                        <select
                          value={speed}
                          onChange={(event) => setSpeed(event.target.value)}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
                        >
                          {REPLAY_SPEEDS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setPlaying(false);
                            setClock(Number.POSITIVE_INFINITY);
                          }}
                          className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-slate-500"
                        >
                          Final state
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {!isRunning && maxRel > 0 ? (
                  <div className="mt-3">
                    <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-sky-500 transition-all duration-100"
                        style={{ width: `${Math.min(100, ((Number.isFinite(clock) ? clock : maxRel) / maxRel) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      {Number.isFinite(clock) ? `${(clock / 1000).toFixed(1)}s` : `${(maxRel / 1000).toFixed(1)}s`} of{" "}
                      {(maxRel / 1000).toFixed(1)}s of recorded activity
                    </div>
                  </div>
                ) : null}
              </div>

              <StageTimeline views={views} />
              <GuardrailBanner run={run} views={views} />
              <StateCards run={run} views={views} />

              {canResume ? (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-emerald-200">Resume from the failed step</h2>
                      <p className="mt-1 text-[12px] text-emerald-100/80">
                        Restarts at <code className="rounded bg-slate-900 px-1">{resumeInfo?.resumeFrom}</code>. Already-completed
                        steps are skipped, not repeated: {resumeInfo?.willSkip.join(", ") || "none"}.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void onResume(true)}
                        disabled={busy !== null}
                        className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40"
                      >
                        {busy === "resume" ? "Resuming…" : "Resume with chaos off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onResume(false)}
                        disabled={busy !== null}
                        className="rounded-md border border-emerald-500/50 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 disabled:opacity-40"
                      >
                        Resume with panel settings
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {run.failureReason ? (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">
                    Failure at {run.failedStage} · {run.failureClass}
                  </div>
                  <p className="mt-1 break-words font-mono text-[11px] leading-snug text-rose-100/90">{run.failureReason}</p>
                </div>
              ) : null}

              <LogStream attempts={attempts} clock={effectiveClock} />
              <AuditTable audit={audit} clock={effectiveClock} />
            </>
          )}
        </section>
      </main>
    </div>
  );
}

