import { useCallback, useEffect, useRef, useState } from "react";
import {
  etClock,
  etHour,
  etWeekday,
  fetchState,
  postAction,
  runDigest,
  sendTestAlert,
  type Asset,
  type ClockMode,
  type ConsoleState,
  type GateConfig,
} from "./api";
import { Button } from "./ui";
import { LiveOps } from "./LiveOps";
import { Injector } from "./Injector";
import { ConfigPanel } from "./ConfigPanel";
import { Audit } from "./Audit";
import { Pages } from "./Pages";
import { Assets } from "./Assets";
import { Digest } from "./Digest";

type TabId = "live" | "inject" | "config" | "audit" | "pages" | "assets" | "digest";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "live", label: "Live ops" },
  { id: "inject", label: "Alert injector" },
  { id: "config", label: "Gate config" },
  { id: "audit", label: "Decision audit" },
  { id: "pages", label: "On-call pages" },
  { id: "assets", label: "Critical assets" },
  { id: "digest", label: "Morning digest" },
];

const CLOCK_MODES: Array<{ id: ClockMode; label: string }> = [
  { id: "real", label: "Real time" },
  { id: "after_hours", label: "Force after-hours" },
  { id: "business_hours", label: "Force business hours" },
];

export default function App() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [digestRunning, setDigestRunning] = useState(false);
  const [tab, setTab] = useState<TabId>("live");
  const [now, setNow] = useState(() => new Date());
  const digestBaseline = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchState();
      setState(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 3000);
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!digestRunning || !state) return;
    const latest = state.digests[0]?.id ?? 0;
    if (digestBaseline.current !== null && latest > digestBaseline.current) {
      setDigestRunning(false);
      setToast(`Digest #${latest} is ready`);
      setTab("digest");
    }
  }, [state, digestRunning]);

  const act = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = await postAction(payload);
      setState(result.state);
      if (result.message) setToast(result.message);
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const inject = async (payload: Record<string, unknown>, label: string) => {
    setBusy(true);
    setToast(`${label} sent to the gate…`);
    try {
      await sendTestAlert(payload);
      for (const delay of [900, 1800, 3000]) {
        await new Promise((r) => setTimeout(r, delay));
        const next = await refresh();
        if (next) setToast(`${label}: gate decided — see the results panel`);
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startDigest = async () => {
    if (!state) return;
    digestBaseline.current = state.digests[0]?.id ?? 0;
    setDigestRunning(true);
    setToast("Digest run started — collecting, correlating, then writing with Claude");
    try {
      await runDigest();
      setTimeout(() => setDigestRunning(false), 180000);
    } catch (err) {
      setDigestRunning(false);
      setToast(err instanceof Error ? err.message : String(err));
    }
  };

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="text-center">
          <p className="text-sm">{error ? `Console API error: ${error}` : "Loading SOC console…"}</p>
          {error && (
            <Button className="mt-3" onClick={() => void refresh()}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  const hour = etHour(now);
  const weekend = etWeekday(now) === 0 || etWeekday(now) === 6;
  const realAfterHours =
    (weekend && state.config.afterHours.weekendsAlwaysAfterHours) || hour >= state.config.afterHours.startHour || hour < state.config.afterHours.endHour;
  const effectiveAfterHours =
    state.clockMode === "after_hours" ? true : state.clockMode === "business_hours" ? false : realAfterHours;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <title>SOC demo console</title>
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-4 px-6 py-4">
          <div>
            <h1 className="text-base font-semibold text-slate-50">Morning SOC digest &amp; after-hours escalation gate</h1>
            <p className="text-[11px] text-slate-500">
              {etClock(now)} · Sentinel, Defender, ServiceNow, Proofpoint and Zscaler are mocked · Slack, Gmail and Claude are live
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <span
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium ${
                effectiveAfterHours ? "border-rose-500/50 bg-rose-500/10 text-rose-200" : "border-teal-500/40 bg-teal-500/10 text-teal-200"
              }`}
            >
              {effectiveAfterHours ? "Gate armed · after-hours" : "Gate standing down · business hours"}
              {state.clockMode !== "real" && <span className="ml-1 text-slate-400">(forced)</span>}
            </span>

            <div className="flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
              {CLOCK_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "set_clock", mode: m.id })}
                  className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                    state.clockMode === m.id ? "bg-sky-500/20 text-sky-200" : "text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <Button variant="danger" disabled={busy} onClick={() => void act({ action: "reset_demo", preloadBacklog: true })}>
              Reset demo
            </Button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-[100rem] gap-1 overflow-x-auto px-6">
          {TABS.map((t) => {
            const badge =
              t.id === "pages"
                ? state.counters.openPages
                : t.id === "digest"
                  ? state.counters.pendingDeferred
                  : t.id === "audit"
                    ? state.decisions.length
                    : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition ${
                  tab === t.id ? "border-sky-400 text-sky-200" : "border-transparent text-slate-500 hover:text-slate-200"
                }`}
              >
                {t.label}
                {badge > 0 && <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-300">{badge}</span>}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-[100rem] px-6 py-6">
        {error && (
          <p className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
            Console API error: {error} — showing the last known state.
          </p>
        )}

        {tab === "live" && <LiveOps state={state} now={now} />}
        {tab === "inject" && (
          <Injector
            state={state}
            now={now}
            busy={busy}
            onScenario={(id) => void inject({ scenario: id }, state.scenarios.find((s) => s.id === id)?.name ?? "Scenario")}
            onCustom={(alert) => void inject({ alert }, "Custom alert")}
          />
        )}
        {tab === "config" && (
          <ConfigPanel
            state={state}
            busy={busy}
            onSave={(config: GateConfig) => void act({ action: "save_config", config })}
            onReplay={() => void act({ action: "replay_last" })}
          />
        )}
        {tab === "audit" && <Audit state={state} now={now} busy={busy} onReplay={(alertId) => void act({ action: "replay_last", alertId })} />}
        {tab === "pages" && (
          <Pages
            state={state}
            now={now}
            busy={busy}
            onAck={(id) => void act({ action: "ack_page", id })}
            onResolve={(id) => void act({ action: "resolve_page", id })}
            onClear={() => void act({ action: "clear_pages" })}
          />
        )}
        {tab === "assets" && (
          <Assets
            state={state}
            busy={busy}
            onSave={(asset: Asset) => void act({ action: "upsert_asset", asset })}
            onDelete={(hostname) => void act({ action: "delete_asset", hostname })}
          />
        )}
        {tab === "digest" && <Digest state={state} now={now} busy={busy} digestRunning={digestRunning} onRun={() => void startDigest()} />}
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900/95 px-4 py-2 text-xs text-slate-100 shadow-xl shadow-black/40">
          {toast}
        </div>
      )}
    </div>
  );
}
