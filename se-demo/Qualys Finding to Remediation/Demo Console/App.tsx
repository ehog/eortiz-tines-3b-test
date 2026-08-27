import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, BRANCH, type ConsoleState } from "./api";
import { Badge, Button, Toast, shortTime } from "./ui";
import FindingsTab from "./FindingsTab";
import PipelineTab from "./PipelineTab";
import PriorityTab from "./PriorityTab";
import RemediationTab from "./RemediationTab";
import TicketsTab from "./TicketsTab";
import ReportTab from "./ReportTab";
import TourOverlay from "./TourOverlay";

const TABS = [
  { path: "findings", label: "Findings" },
  { path: "pipeline", label: "Pipeline" },
  { path: "prioritization", label: "Prioritization" },
  { path: "remediation", label: "Remediation" },
  { path: "tickets", label: "Tickets" },
  { path: "report", label: "Report" },
];

export type Notify = (message: string, tone?: "info" | "error") => void;

export type Shell = {
  state: ConsoleState | null;
  now: Date;
  refreshState: () => Promise<void>;
  notify: Notify;
  /** Runs an action, reports failures, and refreshes shared state afterwards. */
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
  busy: string | null;
};

export default function App() {
  return (
    <BrowserRouter basename={window.__ROUTE_PATH__}>
      <Console />
    </BrowserRouter>
  );
}

function Console() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  const notify = useCallback<Notify>((message, tone = "info") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), tone === "error" ? 9000 : 4500);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      setState(await api.state());
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const run = useCallback<Shell["run"]>(
    async (label, fn) => {
      setBusy(label);
      try {
        await fn();
        await refreshState();
        return true;
      } catch (err) {
        notify(`${label} failed: ${(err as Error).message}`, "error");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [notify, refreshState],
  );

  const now = useMemo(() => (state ? new Date(state.as_of) : new Date()), [state]);
  const shell: Shell = { state, now, refreshState, notify, run, busy };

  const resetDemo = async () => {
    const ok = await run("Reset demo", async () => {
      await api.resetDetections();
      await api.resetTickets();
      await api.resetPipelineState();
      await api.setClock(0);
      await api.resetWeights();
    });
    if (ok) notify("Demo reset: canonical findings reseeded, changes cleared, clock back to today.");
  };

  const seedHistory = async () => {
    const ok = await run("Seed history", async () => {
      await api.seedHistory();
      await api.runReport();
    });
    if (ok) notify("Seeded three weeks of change history and regenerated the report.");
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--page-bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-6 py-3">
          <div>
            <h1 className="text-[18px] leading-tight font-bold">Qualys Finding to Remediation</h1>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Demo console — simulated from Qualys and ServiceNow, live AI remediation
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge tone={BRANCH === "draft" ? "info" : "success"}>
              {BRANCH === "draft" ? "Draft branch" : "Live"}
            </Badge>
            <Badge tone={state && state.clock_offset_days > 0 ? "high" : "neutral"}>
              Demo clock{" "}
              {state
                ? state.clock_offset_days > 0
                  ? `+${state.clock_offset_days}d · ${shortTime(state.as_of)}`
                  : shortTime(state.as_of)
                : "…"}
            </Badge>
            <Button
              onClick={() => setTourOpen(true)}
              variant={tourOpen ? "secondary" : "primary"}
              disabled={tourOpen}
              title="Walk through the demo narrative"
            >
              Guided tour
            </Button>
            <Button onClick={seedHistory} busy={busy === "Seed history"} variant="secondary">
              Seed history
            </Button>
            <Button onClick={resetDemo} busy={busy === "Reset demo"} variant="danger">
              Reset demo
            </Button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-6">
          {TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={`/${tab.path}`}
              className={({ isActive }) =>
                `-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-[var(--accent)] text-[var(--accent-deep)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {loadError && (
          <div className="mb-4 rounded-[10px] border border-[var(--red)]/35 bg-[#fdf1f0] px-4 py-3 text-[13px] text-[var(--red)]">
            Could not load console state: {loadError}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/findings" replace />} />
          <Route path="/findings" element={<FindingsTab shell={shell} />} />
          <Route path="/pipeline" element={<PipelineTab shell={shell} />} />
          <Route path="/prioritization" element={<PriorityTab shell={shell} />} />
          <Route path="/remediation" element={<RemediationTab shell={shell} />} />
          <Route path="/tickets" element={<TicketsTab shell={shell} />} />
          <Route path="/report" element={<ReportTab shell={shell} />} />
          <Route path="*" element={<Navigate to="/findings" replace />} />
        </Routes>
      </main>

      {tourOpen && <TourOverlay shell={shell} onExit={() => setTourOpen(false)} />}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}
