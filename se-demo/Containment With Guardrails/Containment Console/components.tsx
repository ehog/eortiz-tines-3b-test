import { Fragment, useMemo, useState } from "react";
import {
  CHAOS_KEYS,
  CHAOS_META,
  FOLLOW_UP_STAGES,
  PRESETS,
  STAGE_META,
  type AttemptEntry,
  type AuditEntry,
  type ChaosConfig,
  type ChaosKey,
  type RunSummary,
  type StageState,
} from "./data";

export type StageView = {
  key: string;
  label: string;
  service: string;
  timeout: string;
  retries: string;
  sideEffect: boolean;
  status: string;
  attempts: number;
  statusCode: number | null;
  classification: string | null;
  detail: string | null;
  requestKey: string | null;
  durationMs: number | null;
  waitMs: number | null;
  followUp?: boolean;
};

const STATUS_STYLES: Record<string, { chip: string; ring: string; text: string; label: string }> = {
  pending: { chip: "bg-slate-800 text-slate-400", ring: "border-slate-800", text: "text-slate-500", label: "Pending" },
  in_flight: { chip: "bg-sky-500/15 text-sky-300", ring: "border-sky-500/60", text: "text-sky-300", label: "In flight" },
  retrying: { chip: "bg-amber-500/15 text-amber-300", ring: "border-amber-500/60", text: "text-amber-300", label: "Retrying" },
  succeeded: { chip: "bg-emerald-500/15 text-emerald-300", ring: "border-emerald-500/50", text: "text-emerald-300", label: "Succeeded" },
  failed_transient_exhausted: { chip: "bg-rose-500/15 text-rose-300", ring: "border-rose-500/60", text: "text-rose-300", label: "Retries exhausted" },
  failed_permanent: { chip: "bg-rose-600/20 text-rose-200", ring: "border-rose-500/70", text: "text-rose-200", label: "Permanent failure" },
  skipped_guardrail: { chip: "bg-violet-500/15 text-violet-300", ring: "border-violet-500/60", text: "text-violet-300", label: "Blocked by guardrail" },
  skipped_complete: { chip: "bg-emerald-500/10 text-emerald-200/80", ring: "border-emerald-500/30", text: "text-emerald-200/80", label: "Skipped — already done" },
};

const RUN_STATUS_STYLES: Record<string, string> = {
  running: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  contained: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  partial: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  blocked: "bg-violet-500/15 text-violet-300 border-violet-500/40",
  failed: "bg-rose-500/15 text-rose-300 border-rose-500/40",
};

function stageStyle(status: string) {
  return STATUS_STYLES[status] ?? STATUS_STYLES.pending;
}

export function RunStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${RUN_STATUS_STYLES[status] ?? RUN_STATUS_STYLES.failed}`}>
      {status}
    </span>
  );
}

/** Rebuilds stage state from the attempt log as of a replay clock position. */
export function buildStageViews(stages: StageState[], attempts: AttemptEntry[], clock: number): StageView[] {
  const visible = attempts.filter((entry) => entry.relMs <= clock);
  const byStage = new Map<string, AttemptEntry[]>();
  for (const entry of visible) {
    const list = byStage.get(entry.stage) ?? [];
    list.push(entry);
    byStage.set(entry.stage, list);
  }

  const base: StageView[] = STAGE_META.map((meta) => {
    const stageRow = stages.find((row) => row.stage === meta.key);
    const entries = byStage.get(meta.key) ?? [];
    const view: StageView = {
      ...meta,
      status: "pending",
      attempts: 0,
      statusCode: null,
      classification: null,
      detail: stageRow?.detail ?? null,
      requestKey: stageRow?.requestKey ?? null,
      durationMs: null,
      waitMs: null,
    };
    if (entries.length === 0) return view;

    for (const entry of entries) {
      if (entry.event === "stage_start") {
        view.status = "in_flight";
        view.attempts = 0;
        view.detail = entry.message;
        view.waitMs = null;
      } else if (entry.event === "attempt") {
        view.attempts = entry.attempt;
        view.statusCode = entry.statusCode;
        view.classification = entry.classification;
        view.detail = entry.message;
        view.status = entry.outcome === "succeeded" ? "succeeded" : entry.outcome === "permanent" ? "failed_permanent" : "in_flight";
        view.waitMs = null;
      } else if (entry.event === "backoff") {
        view.status = "retrying";
        view.waitMs = Number((entry.payload as { wait_ms?: number } | null)?.wait_ms ?? 0);
        view.detail = entry.message;
      } else if (entry.event === "stage_end") {
        view.status = entry.outcome === "succeeded" ? "succeeded" : entry.outcome;
        view.attempts = entry.attempt;
        view.statusCode = entry.statusCode;
        view.classification = entry.classification;
        view.durationMs = entry.latencyMs;
        view.detail = entry.message;
        view.waitMs = null;
      } else if (entry.event === "stage_skipped") {
        view.status = "skipped_complete";
        view.attempts = entry.attempt;
        view.statusCode = entry.statusCode;
        view.detail = entry.message;
      } else if (entry.event === "guardrail_block") {
        view.status = "skipped_guardrail";
        view.detail = entry.message;
        view.waitMs = null;
      }
    }
    return view;
  });

  for (const [key, label] of Object.entries(FOLLOW_UP_STAGES)) {
    const entries = byStage.get(key);
    if (!entries || entries.length === 0) continue;
    const last = entries[entries.length - 1];
    const stageRow = stages.find((row) => row.stage === key);
    base.push({
      key,
      label,
      service: "ServiceNow",
      timeout: "8s",
      retries: "2 retries",
      sideEffect: true,
      followUp: true,
      status: last.event === "stage_end" ? (last.outcome === "succeeded" ? "succeeded" : last.outcome) : "in_flight",
      attempts: last.attempt,
      statusCode: last.statusCode,
      classification: last.classification,
      detail: last.message,
      requestKey: stageRow?.requestKey ?? null,
      durationMs: stageRow?.durationMs ?? null,
      waitMs: null,
    });
  }

  return base;
}

export function StageTimeline({ views }: { views: StageView[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-5">
      {views.map((view, index) => {
        const style = stageStyle(view.status);
        const active = view.status === "in_flight" || view.status === "retrying";
        return (
          <div
            key={view.key}
            className={`relative rounded-xl border bg-slate-900/60 p-4 transition-all duration-300 ${style.ring} ${
              active ? "shadow-lg shadow-sky-950/50 scale-[1.02]" : ""
            } ${view.followUp ? "lg:col-span-5 border-dashed" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  {view.followUp ? "Follow-up" : `Step ${index + 1}`} · {view.service}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-slate-100">{view.label}</div>
              </div>
              {active ? (
                <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-ping rounded-full bg-sky-400" />
              ) : null}
            </div>

            <div className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${style.chip}`}>
              {style.label}
            </div>

            <dl className="mt-3 space-y-1 text-[11px] text-slate-400">
              <div className="flex justify-between gap-2">
                <dt>Budget</dt>
                <dd className="text-slate-300">
                  {view.timeout} · {view.retries}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Attempts</dt>
                <dd className="text-slate-300">{view.attempts || "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>HTTP</dt>
                <dd className={style.text}>{view.statusCode ?? (view.classification === "transient" ? "timeout" : "—")}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Class</dt>
                <dd className={style.text}>{view.classification ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Elapsed</dt>
                <dd className="text-slate-300">{view.durationMs !== null ? `${(view.durationMs / 1000).toFixed(2)}s` : "—"}</dd>
              </div>
            </dl>

            {view.waitMs ? (
              <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                backing off {(view.waitMs / 1000).toFixed(1)}s before next attempt
              </div>
            ) : null}

            {view.sideEffect ? (
              <div className="mt-2 text-[10px] uppercase tracking-wider text-slate-600">side effect · idempotent</div>
            ) : null}

            {view.detail ? (
              <p className="mt-2 line-clamp-3 text-[11px] leading-snug text-slate-500" title={view.detail}>
                {view.detail}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function GuardrailBanner({ run, views }: { run: RunSummary; views: StageView[] }) {
  const blocked = views.find((view) => view.status === "skipped_guardrail");
  if (!run.guardrail && !blocked) return null;
  const isPartial = run.status === "partial";
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        isPartial ? "border-amber-500/50 bg-amber-500/10 text-amber-100" : "border-violet-500/50 bg-violet-500/10 text-violet-100"
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
        {isPartial ? "Partial containment handled" : "Guardrail engaged"}
      </div>
      <p className="mt-1 leading-snug">{run.guardrail ?? blocked?.detail}</p>
    </div>
  );
}

export function StateCards({ run, views }: { run: RunSummary; views: StageView[] }) {
  const isolate = views.find((view) => view.key === "endpoint_isolate");
  const cards = [
    {
      label: "ServiceNow incident",
      value: run.ticketNumber ?? "not created",
      sub: run.ticketState ? `state: ${run.ticketState}` : "no record exists",
      tone: run.ticketNumber ? (run.ticketState === "containment incomplete" ? "amber" : "emerald") : "slate",
    },
    {
      label: "Endpoint isolation",
      value: run.isolationState ?? "Not isolated",
      sub: isolate?.requestKey ? `key: ${isolate.requestKey}` : "no isolation request issued",
      tone: (run.isolationState ?? "").startsWith("Isolated") ? "emerald" : "rose",
    },
    {
      label: "Contained",
      value: run.status === "contained" ? "yes" : "no",
      sub: run.failedStage ? `stopped at ${run.failedStage}` : "all steps complete",
      tone: run.status === "contained" ? "emerald" : "rose",
    },
    {
      label: "Safe to retry",
      value: run.status === "contained" ? "nothing to do" : run.safeToRetry ? "yes" : "no",
      sub: run.resumeCount > 0 ? `resumed ${run.resumeCount}x` : "completed steps are skipped on resume",
      tone: run.status === "contained" ? "slate" : "sky",
    },
  ];
  const toneClass: Record<string, string> = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
    sky: "text-sky-300",
    slate: "text-slate-300",
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">{card.label}</div>
          <div className={`mt-1 truncate text-lg font-semibold ${toneClass[card.tone]}`} title={card.value}>
            {card.value}
          </div>
          <div className="mt-1 truncate text-[11px] text-slate-500" title={card.sub}>
            {card.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

const LEVEL_COLOR: Record<string, string> = {
  info: "text-emerald-300",
  warn: "text-amber-300",
  error: "text-rose-300",
};

export function LogStream({ attempts, clock }: { attempts: AttemptEntry[]; clock: number }) {
  const [level, setLevel] = useState<string>("all");
  const [stage, setStage] = useState<string>("all");

  const visible = useMemo(
    () =>
      attempts
        .filter((entry) => entry.relMs <= clock)
        .filter((entry) => (level === "all" ? true : entry.level === level))
        .filter((entry) => (stage === "all" ? true : entry.stage === stage))
        .slice()
        .reverse(),
    [attempts, clock, level, stage],
  );

  const stageOptions = useMemo(() => Array.from(new Set(attempts.map((entry) => entry.stage))), [attempts]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Structured log — one line per attempt</div>
        <div className="flex items-center gap-2">
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"
          >
            <option value="all">all stages</option>
            {stageOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"
          >
            <option value="all">all levels</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </div>
      </div>
      <div className="max-h-80 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
        {visible.length === 0 ? <div className="text-slate-600">no log lines yet</div> : null}
        {visible.map((entry) => (
          <div key={entry.id} className="whitespace-pre-wrap border-b border-slate-900/80 py-1 last:border-0">
            <span className="text-slate-600">{new Date(entry.ts).toISOString().slice(11, 23)} </span>
            <span className={LEVEL_COLOR[entry.level] ?? "text-slate-300"}>{entry.level.toUpperCase().padEnd(5)} </span>
            <span className="text-sky-300">{entry.stage}</span>
            <span className="text-slate-500">{entry.attempt ? `#${entry.attempt}` : ""} </span>
            <span className="text-violet-300">{entry.event} </span>
            {entry.statusCode !== null ? <span className="text-slate-400">status={entry.statusCode} </span> : null}
            {entry.classification ? <span className="text-amber-200/80">class={entry.classification} </span> : null}
            {entry.latencyMs !== null ? <span className="text-slate-500">{entry.latencyMs}ms </span> : null}
            <span className="text-slate-300">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  succeeded: "text-emerald-300",
  started: "text-sky-300",
  queued: "text-sky-300",
  contained: "text-emerald-300",
  partial: "text-amber-300",
  blocked: "text-violet-300",
  failed: "text-rose-300",
  failed_transient: "text-amber-300",
  failed_permanent: "text-rose-300",
  not_attempted_guardrail: "text-violet-300",
  skipped_already_complete: "text-emerald-200/80",
};

export function AuditTable({ audit, clock }: { audit: AuditEntry[]; clock: number }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const rows = audit.filter((entry) => entry.relMs <= clock);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Audit trail — every action attempted, with outcome
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-slate-900 text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-2 py-2 font-medium">Action</th>
              <th className="px-2 py-2 font-medium">Target</th>
              <th className="px-2 py-2 font-medium">Try</th>
              <th className="px-2 py-2 font-medium">Outcome</th>
              <th className="px-2 py-2 font-medium">HTTP</th>
              <th className="px-4 py-2 font-medium">Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-slate-600">
                  no audit entries yet
                </td>
              </tr>
            ) : null}
            {rows.map((entry) => (
              <Fragment key={entry.id}>
                <tr
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  className="cursor-pointer border-t border-slate-900 hover:bg-slate-900/60"
                >
                  <td className="px-4 py-2 font-mono text-slate-500">{new Date(entry.ts).toISOString().slice(11, 19)}</td>
                  <td className="px-2 py-2 font-mono text-slate-300">{entry.action}</td>
                  <td className="max-w-[10rem] truncate px-2 py-2 text-slate-400">{entry.target}</td>
                  <td className="px-2 py-2 text-slate-400">{entry.attempt ?? "—"}</td>
                  <td className={`px-2 py-2 font-medium ${OUTCOME_TONE[entry.outcome] ?? "text-slate-300"}`}>{entry.outcome}</td>
                  <td className="px-2 py-2 text-slate-400">{entry.statusCode ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-400">{entry.latencyMs !== null ? `${entry.latencyMs}ms` : "—"}</td>
                </tr>
                {expanded === entry.id ? (
                  <tr className="border-t border-slate-900 bg-slate-950/60">
                    <td colSpan={7} className="px-4 py-3">
                      <dl className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Actor</dt>
                          <dd className="text-slate-300">{entry.actor}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Stage</dt>
                          <dd className="text-slate-300">{entry.stage}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Idempotency key</dt>
                          <dd className="break-all font-mono text-slate-300">{entry.requestKey ?? "none"}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Classification</dt>
                          <dd className="text-slate-300">{entry.classification ?? "n/a"}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Detail</dt>
                          <dd className="whitespace-pre-wrap break-words font-mono text-slate-400">{entry.detail}</dd>
                        </div>
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChaosPanel({
  chaos,
  onChange,
  disabled,
}: {
  chaos: ChaosConfig;
  onChange: (chaos: ChaosConfig) => void;
  disabled: boolean;
}) {
  const update = (key: ChaosKey, patch: Partial<ChaosConfig[ChaosKey]>) =>
    onChange({ ...chaos, [key]: { ...chaos[key], ...patch } });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Chaos mode</h2>
        <span className="text-[11px] text-slate-500">force failures on demand</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(preset.chaos())}
            title={preset.hint}
            className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-300 transition hover:border-sky-500/60 hover:text-sky-200 disabled:opacity-40"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {CHAOS_KEYS.map((key) => {
          const setting = chaos[key];
          const meta = CHAOS_META[key];
          return (
            <div
              key={key}
              className={`rounded-lg border px-3 py-2 transition ${
                setting.enabled ? "border-rose-500/40 bg-rose-500/5" : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={setting.enabled}
                  disabled={disabled}
                  onChange={(event) => update(key, { enabled: event.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-rose-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-200">{meta.label}</span>
                    <code className="rounded bg-slate-800 px-1 text-[10px] text-slate-400">{meta.stage}</code>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{meta.effect}</span>
                </span>
              </label>

              {setting.enabled ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                  <select
                    value={setting.mode}
                    disabled={disabled}
                    onChange={(event) => update(key, { mode: event.target.value as ChaosConfig[ChaosKey]["mode"] })}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300"
                  >
                    <option value="fail_n">fail N attempts, then succeed</option>
                    <option value="always">fail always</option>
                  </select>
                  {setting.mode === "fail_n" ? (
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      N =
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={setting.failures}
                        disabled={disabled}
                        onChange={(event) => update(key, { failures: Number(event.target.value) })}
                        className="w-14 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RunList({
  runs,
  selected,
  onSelect,
}: {
  runs: RunSummary[];
  selected: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Runs
      </div>
      <div className="max-h-72 divide-y divide-slate-900 overflow-auto">
        {runs.length === 0 ? <div className="px-4 py-3 text-[11px] text-slate-600">no runs yet</div> : null}
        {runs.map((run) => (
          <button
            key={run.runId}
            type="button"
            onClick={() => onSelect(run.runId)}
            className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition hover:bg-slate-800/40 ${
              selected === run.runId ? "bg-slate-800/60" : ""
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-slate-200">{run.endpoint}</span>
              <span className="block truncate font-mono text-[10px] text-slate-500">
                {run.alertId} · {new Date(run.createdAt).toISOString().slice(5, 16).replace("T", " ")}
              </span>
            </span>
            <RunStatusBadge status={run.status} />
          </button>
        ))}
      </div>
    </div>
  );
}
