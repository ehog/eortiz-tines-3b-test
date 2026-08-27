import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { LAUNCHER_TOUR, REPORT_TOUR, TourButton, TourProvider, useTour } from "./tour";

const BASE: string = (window as unknown as { __ROUTE_PATH__?: string }).__ROUTE_PATH__ ?? "";
const api = (path: string) => `${BASE}${path}`;

type DemoMode = "random" | "hits" | "clean" | "error";

const MODES: { id: DemoMode; label: string; hint: string }[] = [
  { id: "random", label: "Realistic (random)", hint: "Each source independently hits, misses, or occasionally errors" },
  { id: "hits", label: "Force hits everywhere", hint: "Every source returns matches for every indicator" },
  { id: "clean", label: "Force clean", hint: "Every source explicitly returns no matches" },
  { id: "error", label: "Force one source error", hint: "Microsoft Sentinel fails; the other three still return" },
];

const SAMPLES: { label: string; reason: string; indicators: string }[] = [
  {
    label: "FBI advisory set",
    reason: "FBI FLASH advisory #AA24-109A — Akira ransomware infrastructure",
    indicators: [
      "185.216.71.42",
      "secure-invoice-portal.com",
      "https://docs-sharepoint-review.net/login",
      "44d88612fea8a8f36de82e1278abb02f4c1b3f9a",
      "9f2b6c1e8a5d4f3b7c0e1a2d5f8b4c7e0a3d6f9b2c5e8a1d4f7b0c3e6a9d2f5b",
    ].join("\n"),
  },
  {
    label: "Clean check set",
    reason: "Routine validation of vendor-supplied indicators — expected clean",
    indicators: ["203.0.113.7", "example-vendor-cdn.com", "https://updates.example-vendor-cdn.com/patch"].join("\n"),
  },
  {
    label: "Mixed set",
    reason: "ISAC bulletin 2024-77 — credential phishing kit indicators",
    indicators: ["91.203.145.16", "benefits-update.co", "d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70819a2b"].join("\n"),
  },
];

// Deliberately unparseable line the guided tour injects to demonstrate validation.
const TOUR_INVALID_LINE = "akira-c2-server (from the PDF)";

function classify(value: string): string | null {
  const v = value.trim();
  if (/^[0-9a-f]{40}$/i.test(v)) return "sha1";
  if (/^[0-9a-f]{64}$/i.test(v)) return "sha256";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every((o) => Number(o) <= 255)) return "ipv4";
  if (/^[0-9a-f:]{3,45}$/i.test(v) && v.includes("::")) return "ipv6";
  if (/^https?:\/\/\S+$/i.test(v)) return "url";
  if (/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i.test(v)) return "domain";
  return null;
}

const TYPE_STYLES: Record<string, string> = {
  ipv4: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  ipv6: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  domain: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  url: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30",
  sha1: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  sha256: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${className}`}>
      {children}
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    if (!confirm("Clear all demo hunt history?")) return;
    setResetting(true);
    await fetch(api("/api/reset"), { method: "POST" });
    setResetting(false);
    window.location.href = BASE || "/";
  };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-4">
          <Link to="/" data-tour="shell-brand" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-red-500/15 text-lg ring-1 ring-inset ring-red-500/30">◎</span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">Enterprise IOC Hunt</span>
              <span className="block text-xs text-slate-400">Defender · Sentinel · Proofpoint · Zscaler</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
            <span data-tour="source-banner" className="hidden sm:inline">
              Simulated from Defender · Sentinel · Proofpoint · Zscaler
            </span>
            <button
              onClick={reset}
              disabled={resetting}
              className="rounded-md border border-slate-700 px-3 py-1.5 font-medium text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset demo"}
            </button>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </div>
  );
}

type HuntSummary = {
  huntId: string;
  reason: string;
  demoMode: string;
  createdAt: string;
  status: string;
  indicatorCount: number;
  matchedCount: number | null;
  totalEvents: number | null;
  sourceRowsExpected: number;
  sourceRowsDone: number;
  errorRows: number;
  serviceNowNumber: string | null;
};

function Launcher() {
  const navigate = useNavigate();
  const { register } = useTour();
  const [indicators, setIndicators] = useState(SAMPLES[0]!.indicators);
  const [reason, setReason] = useState(SAMPLES[0]!.reason);
  const [mode, setMode] = useState<DemoMode>("random");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hunts, setHunts] = useState<HuntSummary[]>([]);

  useEffect(() => {
    register({
      applySample: () => {
        setIndicators(SAMPLES[0]!.indicators);
        setReason(SAMPLES[0]!.reason);
        setMode("random");
      },
      addInvalidLine: () =>
        setIndicators((v) => (v.includes(TOUR_INVALID_LINE) ? v : `${v.replace(/\s+$/, "")}\n${TOUR_INVALID_LINE}`)),
      removeInvalidLine: () =>
        setIndicators((v) =>
          v
            .split(/\r?\n/)
            .filter((l) => l.trim() !== TOUR_INVALID_LINE)
            .join("\n"),
        ),
      setForceHits: () => setMode("hits"),
    });
  }, [register]);

  const loadHunts = useCallback(async () => {
    const res = await fetch(api("/api/report"));
    const data = (await res.json()) as { hunts?: HuntSummary[] };
    setHunts(data.hunts ?? []);
  }, []);

  useEffect(() => {
    void loadHunts();
    const t = setInterval(() => void loadHunts(), 4000);
    return () => clearInterval(t);
  }, [loadHunts]);

  const lines = useMemo(
    () =>
      indicators
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((value) => ({ value, type: classify(value) })),
    [indicators],
  );
  const invalid = lines.filter((l) => !l.type);
  const valid = lines.filter((l) => l.type);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(api("/api/hunt"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indicators, reason, demoMode: mode }),
      });
      const data = (await res.json()) as { huntId?: string; error?: string };
      if (!res.ok || !data.huntId) {
        setError(data.error ?? `Submit failed (${res.status})`);
        return;
      }
      navigate(`/h/${data.huntId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Launch a hunt</h1>
            <p className="mt-1 text-sm text-slate-400">
              Submit indicators and a reference. Each indicator is searched across all four tools in parallel.
            </p>
          </div>
          <TourButton tour={LAUNCHER_TOUR} label="Take the tour" />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex flex-wrap items-center gap-2 pb-4">
            <span className="text-xs uppercase tracking-wide text-slate-500">Quick fill</span>
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                onClick={() => {
                  setIndicators(s.indicators);
                  setReason(s.reason);
                }}
                className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
              >
                {s.label}
              </button>
            ))}
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="iocs">
            Indicators — one per line
          </label>
          <textarea
            id="iocs"
            data-tour="indicator-input"
            value={indicators}
            onChange={(e) => setIndicators(e.target.value)}
            spellCheck={false}
            rows={7}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-500"
          />

          <div data-tour="indicator-validation">
            <div className="mt-3 flex flex-wrap gap-2">
              {lines.map((l) => (
                <span key={l.value} className="inline-flex items-center gap-2 rounded-md bg-slate-800/70 px-2 py-1 font-mono text-xs">
                  <span className="max-w-[18rem] truncate text-slate-200">{l.value}</span>
                  {l.type ? (
                    <Badge className={TYPE_STYLES[l.type] ?? ""}>{l.type}</Badge>
                  ) : (
                    <Badge className="bg-red-500/15 text-red-300 ring-red-500/30">unrecognized</Badge>
                  )}
                </span>
              ))}
            </div>
            {invalid.length > 0 && (
              <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {invalid.length} line(s) are not a valid IP, domain, URL, SHA1 or SHA256 and will be rejected.
              </p>
            )}
          </div>

          <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="reason">
            Reason / reference
          </label>
          <input
            id="reason"
            data-tour="reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="FBI advisory #AA24-109A"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-sky-500"
          />

          <fieldset className="mt-5" data-tour="demo-modes">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Demo mode</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => (
                <label
                  key={m.id}
                  className={`cursor-pointer rounded-lg border p-3 transition ${
                    mode === m.id ? "border-sky-500 bg-sky-500/10" : "border-slate-700 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} className="accent-sky-500" />
                    <span className="text-sm font-medium">{m.label}</span>
                  </div>
                  <p className="mt-1 pl-6 text-xs text-slate-400">{m.hint}</p>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

          <div className="mt-5 flex items-center gap-3" data-tour="submit-row">
            <button
              onClick={submit}
              disabled={submitting || valid.length === 0 || !reason.trim()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Dispatching searches…" : `Hunt ${valid.length} indicator${valid.length === 1 ? "" : "s"}`}
            </button>
            <span className="text-xs text-slate-500">Fans out to 4 tools · {valid.length * 4} searches</span>
          </div>
        </div>
      </div>

      <aside className="space-y-3" data-tour="recent-hunts">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent hunts</h2>
        {hunts.length === 0 && <p className="text-sm text-slate-500">No hunts yet.</p>}
        {hunts.map((h) => {
          const running = h.sourceRowsDone < h.sourceRowsExpected || h.status === "searching";
          return (
            <Link
              key={h.huntId}
              to={`/h/${h.huntId}`}
              className="block rounded-lg border border-slate-800 bg-slate-900/50 p-3 transition hover:border-slate-600"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-400">{h.huntId}</span>
                {running ? (
                  <Badge className="animate-pulse bg-sky-500/15 text-sky-300 ring-sky-500/30">searching</Badge>
                ) : h.status === "found" ? (
                  <Badge className="bg-red-500/15 text-red-300 ring-red-500/30">found</Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-300 ring-emerald-500/30">clean</Badge>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-200">{h.reason}</p>
              <p className="mt-1 text-xs text-slate-500">
                {h.indicatorCount} indicator(s)
                {h.matchedCount !== null && ` · ${h.matchedCount} matched`}
                {h.errorRows > 0 && " · incomplete source"}
                {h.serviceNowNumber && ` · ${h.serviceNowNumber}`}
              </p>
              <p className="text-xs text-slate-600">{new Date(h.createdAt).toLocaleString()}</p>
            </Link>
          );
        })}
      </aside>
    </div>
  );
}

type SourceState = {
  source: string;
  label: string;
  state: "searching" | "matched" | "clean" | "incomplete";
  searched: number;
  expected: number;
  matched: number;
  events: number;
  error: string | null;
};

type PerSource = {
  label: string;
  status: "hit" | "no_match" | "error";
  summary: string;
  error?: string | null;
  frequency?: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
  findings?: Record<string, unknown>;
};

type ReportIndicator = {
  value: string;
  type: string;
  found: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
  totalFrequency: number;
  matchedSources: string[];
  incompleteSources: { label: string; reason: string }[];
  sources: Record<string, PerSource>;
  devices: Record<string, unknown>[];
  users: Record<string, unknown>[];
  emailMessages: Record<string, unknown>[];
  networkConnections: Record<string, unknown>[];
  proxyActivity: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
};

type ReportPayload = {
  found: boolean;
  error?: string;
  hunt?: { huntId: string; reason: string; demoMode: string; createdAt: string; status: string; combinedAt: string | null };
  indicators?: { value: string; type: string }[];
  sources?: SourceState[];
  progress?: { expected: number; done: number };
  report?: {
    matchedCount: number;
    indicatorCount: number;
    totalEvents: number;
    anyFound: boolean;
    incompleteSources: { label: string; reason: string | null }[];
    indicators: ReportIndicator[];
  } | null;
  serviceNow?: { number: string; sysId: string; createdAt: string; attachment: string | null } | null;
  blockRequest?: {
    requestedAt: string;
    channel: string | null;
    message: string | null;
    slackTs: string | null;
    slackError: string | null;
    targets: { indicator: string; type: string; system: string; action: string }[];
    decision: string | null;
    decidedAt: string | null;
    approver: string | null;
    executedAt: string | null;
    results: { system: string; action: string; indicator: string; reference: string; detail: string; status: string }[] | null;
  } | null;
};

const TAB_KEYS = [
  ["devices", "Devices"],
  ["users", "Users"],
  ["emailMessages", "Email messages"],
  ["networkConnections", "Network connections"],
  ["proxyActivity", "Proxy activity"],
  ["alerts", "Alerts & incidents"],
] as const;

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-sm text-slate-500">No records from any source.</p>;
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left text-xs">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400">
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold">
                {c.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
              {columns.map((c) => {
                const v = r[c];
                return (
                  <td key={c} className="max-w-[22rem] truncate whitespace-nowrap px-3 py-2 font-mono text-slate-300">
                    {v === null || v === undefined
                      ? "—"
                      : typeof v === "object"
                        ? JSON.stringify(v)
                        : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndicatorCard({ ind }: { ind: ReportIndicator }) {
  const [open, setOpen] = useState(ind.found);
  const [tab, setTab] = useState<(typeof TAB_KEYS)[number][0]>("devices");
  return (
    <div className={`overflow-hidden rounded-xl border ${ind.found ? "border-red-500/40 bg-red-500/[0.04]" : "border-slate-800 bg-slate-900/40"}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className={`grid size-7 shrink-0 place-items-center rounded-md text-xs font-bold ${ind.found ? "bg-red-500/20 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
          {ind.found ? "!" : "✓"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm text-slate-100">{ind.value}</span>
            <Badge className={TYPE_STYLES[ind.type] ?? ""}>{ind.type}</Badge>
            {ind.found ? (
              <Badge className="bg-red-500/15 text-red-300 ring-red-500/30">found</Badge>
            ) : (
              <Badge className="bg-emerald-500/15 text-emerald-300 ring-emerald-500/30">no matches</Badge>
            )}
            {ind.incompleteSources.map((s) => (
              <Badge key={s.label} className="bg-amber-500/15 text-amber-200 ring-amber-500/30">
                {s.label} incomplete
              </Badge>
            ))}
          </span>
          <span className="mt-1 block text-xs text-slate-400">
            {ind.found
              ? `${ind.matchedSources.join(", ")} · ${ind.totalFrequency} events · first seen ${ind.firstSeen ?? "?"} · last seen ${ind.lastSeen ?? "?"}`
              : "Searched in all four tools"}
          </span>
        </span>
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800">
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(ind.sources).map(([key, s]) => (
              <div
                key={key}
                className={`rounded-lg border p-3 ${
                  s.status === "hit"
                    ? "border-red-500/40 bg-red-500/5"
                    : s.status === "error"
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-slate-700 bg-slate-900/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{s.label}</span>
                  {s.status === "hit" ? (
                    <Badge className="bg-red-500/15 text-red-300 ring-red-500/30">hit</Badge>
                  ) : s.status === "error" ? (
                    <Badge className="bg-amber-500/15 text-amber-200 ring-amber-500/30">incomplete</Badge>
                  ) : (
                    <Badge className="bg-slate-700/40 text-slate-300 ring-slate-600">no matches</Badge>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-300">{s.status === "error" ? `Incomplete — ${s.error}` : s.summary}</p>
                {s.status === "hit" && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    first {s.firstSeen} · last {s.lastSeen} · {s.frequency} events
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-800 px-5 pt-3">
            <div className="flex flex-wrap gap-1">
              {TAB_KEYS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition ${
                    tab === key ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                  <span className="ml-1.5 text-slate-500">{(ind[key] as unknown[]).length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-slate-800/30">
            <DataTable rows={ind[tab] as Record<string, unknown>[]} />
          </div>
        </div>
      )}
    </div>
  );
}

function SourceTile({ s }: { s: SourceState }) {
  const styles: Record<SourceState["state"], string> = {
    searching: "border-sky-500/40 bg-sky-500/5",
    matched: "border-red-500/40 bg-red-500/5",
    clean: "border-emerald-500/40 bg-emerald-500/5",
    incomplete: "border-amber-500/40 bg-amber-500/5",
  };
  return (
    <div className={`rounded-xl border p-4 transition ${styles[s.state]}`}>
      <p className="text-sm font-semibold">{s.label}</p>
      {s.state === "searching" ? (
        <p className="mt-2 animate-pulse text-sm text-sky-300">
          Searching… {s.searched}/{s.expected}
        </p>
      ) : s.state === "incomplete" ? (
        <>
          <p className="mt-2 text-sm font-semibold text-amber-300">Incomplete</p>
          <p className="mt-1 text-xs text-amber-200/80">{s.error}</p>
        </>
      ) : s.state === "matched" ? (
        <>
          <p className="mt-2 text-sm font-semibold text-red-300">
            {s.matched} indicator{s.matched === 1 ? "" : "s"} matched
          </p>
          <p className="mt-1 text-xs text-slate-400">{s.events} events</p>
        </>
      ) : (
        <p className="mt-2 text-sm font-semibold text-emerald-300">No matches</p>
      )}
    </div>
  );
}

function Report() {
  const { huntId = "" } = useParams();
  const { register } = useTour();
  const [data, setData] = useState<ReportPayload | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(api(`/api/report?hunt=${encodeURIComponent(huntId)}`));
    setData((await res.json()) as ReportPayload);
  }, [huntId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Polls fast while searches run, slower while an approval is outstanding, and stops once everything settles.
  const settled =
    !!data &&
    (!data.found ||
      (!!data.report &&
        !!data.serviceNow &&
        (!data.blockRequest ||
          data.blockRequest.decision === "denied" ||
          (data.blockRequest.decision === "approved" && !!data.blockRequest.executedAt))));

  useEffect(() => {
    if (settled) return;
    const delay = data?.report ? 3000 : 1500;
    const t = setTimeout(() => void load(), delay);
    return () => clearTimeout(t);
  }, [data, settled, load]);

  useEffect(() => {
    register({
      hasReport: !!data?.report,
      hasIncompleteSources: (data?.report?.incompleteSources.length ?? 0) > 0,
      hasServiceNow: !!data?.serviceNow,
      hasBlockRequest: !!data?.blockRequest,
      hasBlockResults: !!data?.blockRequest?.results,
    });
  }, [data, register]);

  if (!data) return <p className="text-sm text-slate-400">Loading hunt…</p>;
  if (!data.found)
    return (
      <div>
        <p className="text-sm text-red-300">{data.error ?? "Hunt not found."}</p>
        <Link to="/" className="mt-4 inline-block text-sm text-sky-300">
          ← Back to launcher
        </Link>
      </div>
    );

  const hunt = data.hunt!;
  const sources = data.sources ?? [];
  const report = data.report ?? null;
  const running = !report;
  const block = data.blockRequest ?? null;
  const sn = data.serviceNow ?? null;

  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${huntId}-findings.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-xs text-sky-300">
            ← Launcher
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Hunt report</h1>
          <p className="text-sm text-slate-300">{hunt.reason}</p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {hunt.huntId} · started {new Date(hunt.createdAt).toLocaleString()} · demo mode {hunt.demoMode}
          </p>
        </div>
        <div className="flex items-center gap-2" data-tour="report-controls">
          <TourButton tour={REPORT_TOUR} label="Take the tour" />
          {!settled && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-inset ring-sky-500/30">
              <span className="size-1.5 animate-pulse rounded-full bg-sky-400" />
              Live
            </span>
          )}
          <button
            onClick={() => void load()}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
          >
            Refresh
          </button>
          <button onClick={copy} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white">
            {copied ? "Link copied" : "Copy share link"}
          </button>
        </div>
      </div>

      <div data-tour="verdict-banner">
        {running ? (
          <div className="rounded-xl border border-sky-500/40 bg-sky-500/5 px-5 py-4">
            <p className="animate-pulse text-sm font-semibold text-sky-200">
              Hunting across four tools — {data.progress?.done ?? 0} of {data.progress?.expected ?? 0} searches complete
            </p>
            <p className="mt-1 text-xs text-slate-400">This page updates automatically.</p>
          </div>
        ) : report!.anyFound ? (
          <div className="rounded-xl border-2 border-red-500 bg-red-500/10 px-5 py-4">
            <p className="text-lg font-bold tracking-tight text-red-200">
              FOUND — {report!.matchedCount} of {report!.indicatorCount} indicators matched in the environment
            </p>
            <p className="mt-1 text-sm text-red-200/80">
              {report!.totalEvents} matching events. A block request has been{" "}
              {block?.decision === "approved" ? "approved and submitted" : block?.decision === "denied" ? "denied" : "sent for human approval"}.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-emerald-500 bg-emerald-500/10 px-5 py-4">
            <p className="text-lg font-bold tracking-tight text-emerald-200">No matches — all {report!.indicatorCount} indicators clean</p>
            <p className="mt-1 text-sm text-emerald-200/80">Every tool explicitly reported no matching activity.</p>
          </div>
        )}
      </div>

      {report && report.incompleteSources.length > 0 && (
        <div data-tour="partial-banner" className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-5 py-4">
          <p className="text-sm font-semibold text-amber-200">Results are partial</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-100/90">
            {report.incompleteSources.map((s) => (
              <li key={s.label}>
                <strong>{s.label}</strong> — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-tour="source-tiles">
        {sources.map((s) => (
          <SourceTile key={s.source} s={s} />
        ))}
      </div>

      <div className="space-y-3" data-tour="indicator-cards">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Per-indicator findings</h2>
        {report ? (
          report.indicators.map((ind) => <IndicatorCard key={ind.value} ind={ind} />)
        ) : (
          <div className="space-y-2">
            {(data.indicators ?? []).map((i) => (
              <div key={i.value} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
                <span className="font-mono text-sm text-slate-200">{i.value}</span>
                <Badge className={TYPE_STYLES[i.type] ?? ""}>{i.type}</Badge>
                <span className="ml-auto animate-pulse text-xs text-sky-300">searching…</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-tour="servicenow-card">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">ServiceNow record</h2>
          {sn ? (
            <>
              <p className="mt-3 text-lg font-semibold text-slate-100">{sn.number}</p>
              <p className="font-mono text-xs text-slate-500">sys_id {sn.sysId}</p>
              <p className="mt-2 text-xs text-slate-400">Opened {new Date(sn.createdAt).toLocaleString()} · Security Operations</p>
              {sn.attachment && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-md bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300">{sn.attachment}</span>
                  <button onClick={download} className="text-xs font-medium text-sky-300 hover:text-sky-200">
                    Download findings
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">{running ? "Created once the hunt completes." : "Not created."}</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-tour="block-card">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Block request</h2>
          {!block ? (
            <p className="mt-3 text-sm text-slate-500">
              {running ? "Requested only if an indicator is found." : "No block request — nothing was found."}
            </p>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2">
                {block.decision === "approved" ? (
                  <Badge className="bg-emerald-500/15 text-emerald-300 ring-emerald-500/30">approved</Badge>
                ) : block.decision === "denied" ? (
                  <Badge className="bg-slate-700/40 text-slate-300 ring-slate-600">denied</Badge>
                ) : (
                  <Badge className="animate-pulse bg-amber-500/15 text-amber-200 ring-amber-500/30">awaiting approval</Badge>
                )}
                <span className="text-xs text-slate-400">
                  requested {new Date(block.requestedAt).toLocaleString()}
                  {block.channel && ` · Slack ${block.channel}`}
                </span>
              </div>
              {block.slackError && (
                <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Slack notification failed: {block.slackError}
                </p>
              )}
              {block.decidedAt && (
                <p className="mt-2 text-xs text-slate-400">
                  {block.decision} by {block.approver} at {new Date(block.decidedAt).toLocaleString()}
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {block.targets.map((t, i) => {
                  const result = block.results?.[i];
                  return (
                    <li key={`${t.system}-${t.indicator}`} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-200">
                        {t.system} — {t.action}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400">{t.indicator}</p>
                      {result ? (
                        <p className="mt-1 text-[11px] text-emerald-300">
                          {result.status} · {result.reference} · {result.detail}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-500">
                          {block.decision === "denied" ? "not submitted (denied)" : "pending approval"}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {block.message && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-slate-400">Slack message sent</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-[11px] text-slate-300">{block.message}</pre>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={BASE || "/"}>
      <TourProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<Launcher />} />
            <Route path="/h/:huntId" element={<Report />} />
          </Routes>
        </Shell>
      </TourProvider>
    </BrowserRouter>
  );
}
