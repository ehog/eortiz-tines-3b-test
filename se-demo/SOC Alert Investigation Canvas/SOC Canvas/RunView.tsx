import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  SOURCE_KEYS,
  SOURCE_LABELS,
  fetchInvestigation,
  forceTimeline,
  formatTime,
  rerunStage,
  retrySource,
  type Investigation,
  type SourceKey,
} from "./api";
import { Button, Card, Chip, SectionTitle, SOURCE_STYLES, Spinner } from "./ui";

export default function RunView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySource, setBusySource] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const advanced = useRef(false);

  useEffect(() => {
    document.title = `Running ${id} · SOC Canvas`;
  }, [id]);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const next = await fetchInvestigation(id);
        if (!active) return;
        setData(next);
        setError(null);
      } catch (problem) {
        if (active) setError(problem instanceof Error ? problem.message : String(problem));
      }
    }
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!data?.status.summary || !autoAdvance || advanced.current) return;
    advanced.current = true;
    const timer = setTimeout(() => navigate(`/investigation/${id}`), 1200);
    return () => clearTimeout(timer);
  }, [data?.status.summary, autoAdvance, id, navigate]);

  const stages = buildStages(data);
  const pending = SOURCE_KEYS.filter((source) => !data?.status.sources[source]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="font-mono text-xs text-teal-400 hover:text-teal-300">
            ← launcher
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">
            {data?.incident.title ?? "Waiting for intake…"}
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{id}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(event) => setAutoAdvance(event.target.checked)}
              className="size-3.5 accent-teal-500"
            />
            auto-open canvas
          </label>
          <Button variant="ghost" onClick={() => navigate(`/investigation/${id}`)} disabled={!data?.status.timeline}>
            Open canvas
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error} — the intake step may still be starting; polling continues.
        </div>
      ) : null}

      <Card className="mb-6">
        <SectionTitle hint={data?.status.complete ? "run complete" : "polling every 1.5s"}>Pipeline</SectionTitle>
        <div className="divide-y divide-slate-800/70">
          {stages.map((stage) => (
            <div key={stage.key} className="flex items-center gap-3 px-4 py-3">
              <StatusDot state={stage.state} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-200">{stage.label}</p>
                {stage.detail ? <p className="truncate text-xs text-slate-500">{stage.detail}</p> : null}
              </div>
              {stage.source ? (
                <Chip className={SOURCE_STYLES[stage.source]}>{stage.source}</Chip>
              ) : null}
              {stage.source ? (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={busySource !== null}
                  onClick={async () => {
                    setBusySource(stage.source ?? null);
                    try {
                      await retrySource(id, stage.source as SourceKey);
                    } catch (problem) {
                      setError(problem instanceof Error ? problem.message : String(problem));
                    } finally {
                      setBusySource(null);
                    }
                  }}
                >
                  {busySource === stage.source ? "…" : "retry"}
                </Button>
              ) : null}
              {stage.rerun ? (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={busySource !== null || !data?.status.timeline}
                  onClick={async () => {
                    setBusySource(stage.key);
                    try {
                      await rerunStage(id, stage.rerun as "summarize" | "servicenow");
                    } catch (problem) {
                      setError(problem instanceof Error ? problem.message : String(problem));
                    } finally {
                      setBusySource(null);
                    }
                  }}
                >
                  {busySource === stage.key ? "…" : "re-run"}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {pending.length > 0 && data?.status.entities ? (
          <div className="flex items-center justify-between gap-3 border-t border-slate-800 px-4 py-3">
            <span className="text-xs text-slate-500">
              The timeline waits for all five sources. If one stays stuck you can build it from what has landed.
            </span>
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={async () => {
                try {
                  await forceTimeline(id);
                } catch (problem) {
                  setError(problem instanceof Error ? problem.message : String(problem));
                }
              }}
            >
              Build timeline anyway
            </Button>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionTitle hint={`${data?.logs.length ?? 0} events`}>Structured event log</SectionTitle>
        <div className="max-h-96 overflow-auto">
          {(data?.logs ?? []).length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400">
              <Spinner /> waiting for the first enrichment event…
            </div>
          ) : (
            <table className="w-full text-left font-mono text-[11px]">
              <tbody>
                {(data?.logs ?? []).map((log, index) => (
                  <tr key={`${log.ts}-${index}`} className="border-t border-slate-800/60">
                    <td className="px-4 py-1.5 whitespace-nowrap text-slate-500">{formatTime(log.ts)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-400">{log.step}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-teal-300">{log.event}</td>
                    <td className="max-w-xs truncate px-2 py-1.5 text-slate-300">{log.target}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-400">{log.outcome}</td>
                    <td className="px-4 py-1.5 text-right whitespace-nowrap text-slate-500">{log.durationMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

type StageState = "done" | "running" | "waiting";

function buildStages(data: Investigation | null): {
  key: string;
  label: string;
  detail?: string;
  state: StageState;
  source?: string;
  rerun?: "summarize" | "servicenow";
}[] {
  const stages: {
    key: string;
    label: string;
    detail?: string;
    state: StageState;
    source?: string;
    rerun?: "summarize" | "servicenow";
  }[] = [
    {
      key: "intake",
      label: "Incident received and normalized",
      detail: data ? `${data.incident.source} · ${data.incident.correlationId} · alert ${formatTime(data.incident.alertTime)}` : undefined,
      state: data?.status.incident ? "done" : "running",
    },
    {
      key: "entities",
      label: "Entities extracted",
      detail: data?.entities
        ? `${data.entities.users.length} users · ${data.entities.devices.length} devices · ${data.entities.externalIps.length} external IPs · ${data.entities.domains.length} domains · ${data.entities.hashes.length} hashes`
        : undefined,
      state: data?.status.entities ? "done" : data?.status.incident ? "running" : "waiting",
    },
  ];

  for (const source of SOURCE_KEYS) {
    const record = data?.sources?.[source];
    const done = Boolean(data?.status.sources[source]);
    stages.push({
      key: source,
      label: SOURCE_LABELS[source],
      source,
      detail: done
        ? `${record?.recordCount ?? 0} records · ${record?.eventCount ?? 0} timeline events · ${record?.durationMs ?? 0}ms${record?.mocked ? " · mock" : ""}`
        : data?.status.entities
          ? "querying…"
          : undefined,
      state: done ? "done" : data?.status.entities ? "running" : "waiting",
    });
  }

  stages.push(
    {
      key: "timeline",
      label: "Chronological timeline merged",
      detail: data?.timeline ? `${data.timeline.eventCount} events across ${5 - data.timeline.missingSources.length} sources` : undefined,
      state: data?.status.timeline ? "done" : SOURCE_KEYS.every((s) => data?.status.sources[s]) ? "running" : "waiting",
    },
    {
      key: "summary",
      label: "Claude analyst summary and disposition",
      detail: data?.summary ? `${data.summary.disposition} · confidence ${data.summary.confidence}% · ${data.summary.model}` : undefined,
      state: data?.status.summary ? "done" : data?.status.timeline ? "running" : "waiting",
      rerun: "summarize",
    },
    {
      key: "servicenow",
      label: "ServiceNow security incident",
      detail: data?.servicenow ? `${data.servicenow.number} · ${data.servicenow.action}` : undefined,
      state: data?.status.servicenow ? "done" : data?.status.summary ? "running" : "waiting",
      rerun: "servicenow",
    },
  );

  return stages;
}

function StatusDot({ state }: { state: StageState }) {
  if (state === "done") {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-teal-500/20 text-[11px] text-teal-300 ring-1 ring-teal-500/40">
        ✓
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="flex size-5 items-center justify-center">
        <Spinner />
      </span>
    );
  }
  return <span className="size-5 rounded-full border border-slate-700 bg-slate-800/40" />;
}
