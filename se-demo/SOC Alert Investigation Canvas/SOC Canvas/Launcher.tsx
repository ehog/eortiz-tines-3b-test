import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchRecent, formatTime, launchIncident, type RecentInvestigation } from "./api";
import { SCENARIOS, type Scenario } from "./scenarios";
import { useTour } from "./Tour";
import { Button, Card, Chip, DISPOSITION_STYLES, SectionTitle, SEVERITY_STYLES, Spinner, Json } from "./ui";

export default function Launcher() {
  const navigate = useNavigate();
  const tour = useTour();
  const [recent, setRecent] = useState<RecentInvestigation[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    document.title = "SOC Alert Investigation Canvas";
    fetchRecent()
      .then(setRecent)
      .catch((problem: Error) => setError(problem.message));
  }, []);

  async function launch(key: string, payload: unknown) {
    setBusy(key);
    setError(null);
    try {
      const id = await launchIncident(payload);
      navigate(`/run/${id}`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10">
        <p className="mb-2 font-mono text-xs tracking-widest text-teal-400 uppercase">Tines 3B · demo console</p>
        <h1 className="text-3xl font-semibold text-slate-100">SOC Alert Investigation Canvas</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">
          Fire a Sentinel or Defender incident at the intake webhook, watch five enrichment sources run in parallel, and
          land on an analyst canvas with an AI disposition, a merged timeline, Proofpoint captures and a gated isolate
          action. Every integration except Claude is mocked.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={tour.start} dataTour="tour-start">
            ▸ Start guided tour
          </Button>
          <span className="text-xs text-slate-500">
            Nine stops, end to end — it fires the Defender scenario, follows the run and walks the canvas.
          </span>
        </div>
      </header>

      {error ? (
        <div className="mb-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        {SCENARIOS.map((scenario) => (
          <ScenarioCard
            key={scenario.key}
            scenario={scenario}
            busy={busy === scenario.key}
            disabled={busy !== null}
            rawOpen={showRaw === scenario.key}
            onToggleRaw={() => setShowRaw(showRaw === scenario.key ? null : scenario.key)}
            onLaunch={() => launch(scenario.key, scenario.build(new Date()))}
          />
        ))}
      </div>

      <Card className="mt-6">
        <button
          type="button"
          onClick={() => setCustomOpen(!customOpen)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-300 hover:bg-slate-800/40"
        >
          <span>Advanced — paste your own Sentinel or Defender payload</span>
          <span className="text-slate-500">{customOpen ? "−" : "+"}</span>
        </button>
        {customOpen ? (
          <div className="border-t border-slate-800 p-4">
            <textarea
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              spellCheck={false}
              placeholder='{"properties": {"title": "…", "severity": "High", "entities": []}}'
              className="h-48 w-full rounded-lg border border-slate-800 bg-slate-950/80 p-3 font-mono text-[11px] text-slate-200 outline-none focus:border-teal-500"
            />
            <div className="mt-3 flex items-center gap-3">
              <Button
                disabled={busy !== null || custom.trim().length === 0}
                onClick={() => {
                  try {
                    launch("custom", JSON.parse(custom));
                  } catch {
                    setError("custom payload is not valid JSON");
                  }
                }}
              >
                {busy === "custom" ? "Launching…" : "Launch custom payload"}
              </Button>
              <span className="text-xs text-slate-500">
                Shape is auto-detected: an <code className="font-mono">alerts</code> array reads as Defender, a{" "}
                <code className="font-mono">properties</code> object reads as Sentinel.
              </span>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="mt-10">
        <SectionTitle hint={recent ? `${recent.length} shown` : undefined}>Recent investigations</SectionTitle>
        {recent === null ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400">
            <Spinner /> Loading history…
          </div>
        ) : recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No investigations yet — launch a scenario above.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Received</th>
                <th className="px-4 py-2 font-medium">Alert</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Disposition</th>
                <th className="px-4 py-2 font-medium">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((item) => {
                const disposition = item.disposition ? DISPOSITION_STYLES[item.disposition] : null;
                return (
                  <tr
                    key={item.investigationId}
                    onClick={() => navigate(item.disposition ? `/investigation/${item.investigationId}` : `/run/${item.investigationId}`)}
                    className="cursor-pointer border-t border-slate-800/70 transition hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap text-slate-400">
                      {formatTime(item.receivedAt)}
                    </td>
                    <td className="max-w-md truncate px-4 py-3 text-slate-200">{item.title}</td>
                    <td className="px-4 py-3">
                      <Chip className={SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.informational}>
                        {item.source} · {item.severity}
                      </Chip>
                    </td>
                    <td className="px-4 py-3">
                      {disposition ? (
                        <span className={`text-xs font-semibold ${disposition.accent}`}>
                          {disposition.label} · {item.confidence}%
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">in progress</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-400">{item.servicenowNumber ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ScenarioCard({
  scenario,
  busy,
  disabled,
  rawOpen,
  onToggleRaw,
  onLaunch,
}: {
  scenario: Scenario;
  busy: boolean;
  disabled: boolean;
  rawOpen: boolean;
  onToggleRaw: () => void;
  onLaunch: () => void;
}) {
  return (
    <Card className="flex flex-col p-5" dataTour={`scenario-${scenario.key}`}>
      <p className="font-mono text-[10px] tracking-wider text-slate-500 uppercase">{scenario.shape}</p>
      <h2 className="mt-2 text-lg font-semibold text-slate-100">{scenario.name}</h2>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">{scenario.blurb}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {scenario.entities.map((entity) => (
          <Chip key={entity} className="bg-slate-800/80 font-mono text-slate-300 ring-slate-700">
            {entity}
          </Chip>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-2">
        <Button onClick={onLaunch} disabled={disabled} dataTour={`launch-${scenario.key}`}>
          {busy ? "Launching…" : "Launch investigation"}
        </Button>
        <Button variant="ghost" onClick={onToggleRaw} dataTour={`raw-${scenario.key}`}>
          {rawOpen ? "Hide payload" : "View raw payload"}
        </Button>
      </div>
      {rawOpen ? (
        <div className="mt-4">
          <Json value={scenario.build(new Date())} />
        </div>
      ) : null}
    </Card>
  );
}
