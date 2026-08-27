import { useCallback, useEffect, useMemo, useState } from "react";
import Tour from "./Tour";

const BASE = (window as unknown as { __ROUTE_PATH__?: string }).__ROUTE_PATH__ ?? "";
const ROOT = BASE.replace(/\/console$/, "");
const DATA_URL = `${ROOT}/api/patching`;
const DECIDE_URL = `${ROOT}/api/decide`;

type Finding = {
  id: string;
  device_id: string;
  device_name: string;
  package_id: string;
  package_name: string;
  severity: string;
  first_seen: string;
  last_seen: string;
  status: "open" | "patching" | "postponed" | string;
};

type Decision = {
  id: number;
  device_name: string;
  package_name: string;
  severity: string;
  decision: "YES" | "NO" | string;
  decided_by: string;
  decided_at: string;
  source: string;
};

type State = {
  generated_at: string;
  last_run: { ran_at: string; devices: number; matches: number } | null;
  totals: { findings: number; devices: number; patched: number; postponed: number };
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  by_day: { day: string; patched: number; postponed: number }[];
  findings: Finding[];
  decisions: Decision[];
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "unknown"];

function severityRank(severity: string) {
  const i = SEVERITY_ORDER.indexOf(severity.toLowerCase());
  return i === -1 ? SEVERITY_ORDER.length : i;
}

function severityClasses(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-red-500/15 text-red-300 ring-red-500/30";
    case "high":
      return "bg-orange-500/15 text-orange-300 ring-orange-500/30";
    case "medium":
      return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
    case "low":
      return "bg-sky-500/15 text-sky-300 ring-sky-500/30";
    default:
      return "bg-slate-500/15 text-slate-300 ring-slate-500/30";
  }
}

function statusClasses(status: string) {
  switch (status) {
    case "patching":
      return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
    case "postponed":
      return "bg-violet-500/15 text-violet-300 ring-violet-500/30";
    default:
      return "bg-slate-500/15 text-slate-300 ring-slate-500/30";
  }
}

function timeAgo(iso: string) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function Badge({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>
      {text}
    </span>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"findings" | "history">("findings");
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [pending, setPending] = useState<Record<string, "YES" | "NO">>({});
  const [confirm, setConfirm] = useState<{ finding: Finding; decision: "YES" | "NO" } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tour, setTour] = useState(false);
  const [tourReturnTab, setTourReturnTab] = useState<"findings" | "history">("findings");

  const load = useCallback(async () => {
    try {
      const res = await fetch(DATA_URL, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setState((await res.json()) as State);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const findings = state?.findings ?? [];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings
      .filter((f) => (statusFilter === "all" ? true : f.status === statusFilter))
      .filter((f) => (severityFilter === "all" ? true : f.severity === severityFilter))
      .filter((f) => !q || f.device_name.toLowerCase().includes(q) || f.package_name.toLowerCase().includes(q));
  }, [findings, query, severityFilter, statusFilter]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Finding[]>();
    for (const f of visible) {
      const list = groups.get(f.severity) ?? [];
      list.push(f);
      groups.set(f.severity, list);
    }
    return [...groups.entries()].sort(([a], [b]) => severityRank(a) - severityRank(b));
  }, [visible]);

  const severities = useMemo(
    () => [...new Set(findings.map((f) => f.severity))].sort((a, b) => severityRank(a) - severityRank(b)),
    [findings],
  );

  async function decide(finding: Finding, decision: "YES" | "NO") {
    setConfirm(null);
    setPending((p) => ({ ...p, [finding.id]: decision }));
    setState((prev) =>
      prev
        ? {
            ...prev,
            findings: prev.findings.map((f) =>
              f.id === finding.id ? { ...f, status: decision === "YES" ? "patching" : "postponed" } : f,
            ),
          }
        : prev,
    );
    try {
      const res = await fetch(DECIDE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          device_id: finding.device_id,
          device_name: finding.device_name,
          package_id: finding.package_id,
          package_name: finding.package_name,
          severity: finding.severity,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
      setToast(
        decision === "YES"
          ? `Queued ${finding.package_name} on ${finding.device_name} in Automox.`
          : `Postponed ${finding.package_name} on ${finding.device_name} — a Tines case is being opened.`,
      );
    } catch (e) {
      setToast(`Failed: ${e instanceof Error ? e.message : String(e)}`);
      setState((prev) =>
        prev
          ? { ...prev, findings: prev.findings.map((f) => (f.id === finding.id ? { ...f, status: finding.status } : f)) }
          : prev,
      );
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[finding.id];
        return next;
      });
      void load();
    }
  }

  const maxDay = Math.max(1, ...(state?.by_day ?? []).map((d) => d.patched + d.postponed));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 antialiased">
      <title>Patch console</title>
      <header className="border-b border-slate-800 bg-slate-950/80 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Patch console</h1>
            <p className="text-sm text-slate-500">
              Automox vulnerability findings and patch decisions
              {state?.last_run ? ` · last scan ${timeAgo(state.last_run.ran_at)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div data-tour="view-switcher" className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
              {(["findings", "history"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                    tab === t ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-700 hover:text-slate-100"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => {
                setTourReturnTab(tab);
                setTour(true);
              }}
              className="rounded-lg border border-sky-800 bg-sky-950/60 px-3 py-1.5 text-sm font-medium text-sky-200 transition hover:border-sky-600 hover:text-sky-100"
            >
              Tour
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {error ? (
          <div className="mb-6 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
            Could not load patching state: {error}
          </div>
        ) : null}

        <div data-tour="metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label="Open findings"
            value={state?.by_status.open ?? 0}
            hint={`${state?.totals.devices ?? 0} device${(state?.totals.devices ?? 0) === 1 ? "" : "s"} affected`}
          />
          <Metric label="Total findings" value={state?.totals.findings ?? 0} />
          <Metric label="Patched" value={state?.totals.patched ?? 0} hint="decisions recorded" />
          <Metric label="Postponed" value={state?.totals.postponed ?? 0} hint="tracked in Tines cases" />
        </div>

        {tab === "findings" ? (
          <section className="mt-6">
            <div data-tour="filters" className="mb-4 flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search device or package"
                className="w-64 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-slate-600 focus:outline-none"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300 focus:border-slate-600 focus:outline-none"
              >
                <option value="open">Open</option>
                <option value="patching">Patching</option>
                <option value="postponed">Postponed</option>
                <option value="all">All statuses</option>
              </select>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300 focus:border-slate-600 focus:outline-none"
              >
                <option value="all">All severities</option>
                {severities.map((s) => (
                  <option key={s} value={s}>
                    {s} ({state?.by_severity[s] ?? 0})
                  </option>
                ))}
              </select>
              <span className="ml-auto text-sm text-slate-500 tabular-nums">
                {visible.length} of {findings.length}
              </span>
            </div>

            {loading ? (
              <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
                Loading findings…
              </p>
            ) : grouped.length === 0 ? (
              <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
                No findings match these filters.
              </p>
            ) : (
              <div className="space-y-6">
                {grouped.map(([severity, items], groupIndex) => (
                  <div
                    key={severity}
                    data-tour={groupIndex === 0 ? "findings-table" : undefined}
                    className="overflow-hidden rounded-xl border border-slate-800"
                  >
                    <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/70 px-4 py-2.5">
                      <Badge text={severity} className={severityClasses(severity)} />
                      <span className="text-sm text-slate-400 tabular-nums">{items.length}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                        <tr className="border-b border-slate-800/80">
                          <th className="px-4 py-2 font-medium">Package</th>
                          <th className="px-4 py-2 font-medium">Device</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                          <th className="px-4 py-2 font-medium">Seen</th>
                          <th className="px-4 py-2 text-right font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((f, rowIndex) => {
                          const busy = pending[f.id];
                          return (
                            <tr key={f.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/40">
                              <td className="px-4 py-2.5 font-medium text-slate-100">{f.package_name}</td>
                              <td className="px-4 py-2.5 text-slate-400">{f.device_name}</td>
                              <td className="px-4 py-2.5">
                                <Badge text={f.status} className={statusClasses(f.status)} />
                              </td>
                              <td className="px-4 py-2.5 text-slate-500">{timeAgo(f.last_seen)}</td>
                              <td className="px-4 py-2.5">
                                <div
                                  data-tour={groupIndex === 0 && rowIndex === 0 ? "row-actions" : undefined}
                                  className="flex justify-end gap-2"
                                >

                                  <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() => setConfirm({ finding: f, decision: "YES" })}
                                    className="rounded-md bg-emerald-600/90 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
                                  >
                                    {busy === "YES" ? "Queuing…" : "Patch now"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() => setConfirm({ finding: f, decision: "NO" })}
                                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-40"
                                  >
                                    {busy === "NO" ? "Filing…" : "Postpone"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <div className="border-b border-slate-800 bg-slate-900/70 px-4 py-2.5 text-sm font-medium text-slate-300">
                Decision history
              </div>
              {(state?.decisions.length ?? 0) === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">No decisions recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {state?.decisions.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                      <Badge
                        text={d.decision === "YES" ? "patched" : "postponed"}
                        className={statusClasses(d.decision === "YES" ? "patching" : "postponed")}
                      />
                      <span className="font-medium text-slate-100">{d.package_name}</span>
                      <span className="text-slate-500">on</span>
                      <span className="text-slate-300">{d.device_name}</span>
                      <Badge text={d.severity} className={severityClasses(d.severity)} />
                      <span className="ml-auto text-xs text-slate-500">
                        {d.decided_by} · via {d.source} · {timeAgo(d.decided_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div data-tour="history-charts" className="space-y-6">
              <div className="rounded-xl border border-slate-800 p-4">
                <h2 className="text-sm font-medium text-slate-300">Findings by severity</h2>
                <ul className="mt-3 space-y-2">
                  {severities.length === 0 ? (
                    <li className="text-sm text-slate-500">No findings.</li>
                  ) : (
                    severities.map((s) => {
                      const count = state?.by_severity[s] ?? 0;
                      const total = Math.max(1, state?.totals.findings ?? 1);
                      return (
                        <li key={s} className="flex items-center gap-3">
                          <span className="w-16 text-xs capitalize text-slate-400">{s}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-sky-500"
                              style={{ width: `${Math.round((count / total) * 100)}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs text-slate-400 tabular-nums">{count}</span>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>

              <div className="rounded-xl border border-slate-800 p-4">
                <h2 className="text-sm font-medium text-slate-300">Decisions per day</h2>
                <ul className="mt-3 space-y-2">
                  {(state?.by_day.length ?? 0) === 0 ? (
                    <li className="text-sm text-slate-500">No decisions yet.</li>
                  ) : (
                    state?.by_day.map((d) => (
                      <li key={d.day} className="flex items-center gap-3">
                        <span className="w-16 text-xs text-slate-400">{d.day.slice(5)}</span>
                        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${(d.patched / maxDay) * 100}%` }}
                          />
                          <div
                            className="h-full bg-violet-500"
                            style={{ width: `${(d.postponed / maxDay) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-xs text-slate-400 tabular-nums">
                          {d.patched + d.postponed}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
                <div className="mt-3 flex gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> patched
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-violet-500" /> postponed
                  </span>
                </div>
              </div>

              {state?.last_run ? (
                <p className="text-xs text-slate-600">
                  Last scan {new Date(state.last_run.ran_at).toLocaleString()} · {state.last_run.devices} devices ·{" "}
                  {state.last_run.matches} matches
                </p>
              ) : null}
            </div>
          </section>
        )}
      </main>

      {confirm ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-slate-100">
              {confirm.decision === "YES" ? "Patch now?" : "Postpone patching?"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {confirm.decision === "YES" ? (
                <>
                  Automox will queue an <span className="text-slate-200">InstallUpdate</span> for{" "}
                  <span className="text-slate-200">{confirm.finding.package_name}</span> on{" "}
                  <span className="text-slate-200">{confirm.finding.device_name}</span>. This changes the real device.
                </>
              ) : (
                <>
                  A Tines case will be opened to track{" "}
                  <span className="text-slate-200">{confirm.finding.package_name}</span> on{" "}
                  <span className="text-slate-200">{confirm.finding.device_name}</span>, and a summary posted to Slack.
                </>
              )}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void decide(confirm.finding, confirm.decision)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white transition ${
                  confirm.decision === "YES" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-violet-600 hover:bg-violet-500"
                }`}
              >
                {confirm.decision === "YES" ? "Patch now" : "Postpone"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tour ? (
        <Tour
          setTab={setTab}
          onClose={() => {
            setTour(false);
            setTab(tourReturnTab);
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 shadow-xl">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
