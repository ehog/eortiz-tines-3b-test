import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  SOURCE_KEYS,
  SOURCE_LABELS,
  fetchInvestigation,
  formatTime,
  isolateEndpoint,
  screenshotUrl,
  type Investigation,
} from "./api";
import {
  Button,
  Card,
  Chip,
  Collapsible,
  DISPOSITION_STYLES,
  Json,
  SectionTitle,
  SEVERITY_STYLES,
  SOURCE_STYLES,
  Spinner,
} from "./ui";

export default function Canvas() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchInvestigation(id));
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    document.title = data ? `${data.incident.title} · SOC Canvas` : `Investigation ${id} · SOC Canvas`;
  }, [data, id]);

  const events = data?.timeline?.events ?? [];
  const entityOptions = useMemo(() => {
    const entities = new Set<string>();
    for (const event of events) if (event.entity) entities.add(event.entity);
    return [...entities].sort();
  }, [events]);

  const visibleEvents = events.filter(
    (event) =>
      (sourceFilter.length === 0 || sourceFilter.includes(event.source)) &&
      (entityFilter === null || event.entity === entityFilter),
  );

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-sm text-rose-300">{error}</p>
        <Link to="/" className="mt-4 inline-block font-mono text-xs text-teal-400">
          ← launcher
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
        <Spinner /> loading investigation…
      </div>
    );
  }

  const disposition = data.summary ? DISPOSITION_STYLES[data.summary.disposition] : null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/" className="font-mono text-xs text-teal-400 hover:text-teal-300">
            ← launcher
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">{data.incident.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Chip className={SEVERITY_STYLES[data.incident.severity] ?? SEVERITY_STYLES.informational}>
              {data.incident.source} · {data.incident.severity}
            </Chip>
            <span className="font-mono">{data.incident.correlationId}</span>
            <span>alert {formatTime(data.incident.alertTime)}</span>
            <span className="font-mono">{id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/run/${id}`} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500">
            Run view
          </Link>
          <Button variant="ghost" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card
            dataTour="disposition"
            className={`bg-gradient-to-br p-5 ring-1 ${
              disposition ? disposition.classes : "from-slate-800/40 to-slate-900 ring-slate-700"
            }`}
          >
            {data.summary ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] tracking-widest text-slate-400 uppercase">
                      AI disposition · {data.summary.model}
                    </p>
                    <h2 className={`mt-1 text-2xl font-semibold ${disposition?.accent ?? "text-slate-100"}`}>
                      {disposition?.label ?? data.summary.disposition}
                    </h2>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-semibold text-slate-100">{data.summary.confidence}%</p>
                    <p className="text-[11px] text-slate-400">model confidence</p>
                  </div>
                </div>
                <p className="mt-4 text-base font-medium text-slate-100">{data.summary.headline}</p>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-slate-300">{data.summary.summary}</p>
                {data.summary.attackNarrative ? (
                  <p className="mt-3 border-l-2 border-slate-600 pl-3 text-sm leading-relaxed whitespace-pre-line text-slate-400">
                    {data.summary.attackNarrative}
                  </p>
                ) : null}
                {data.summary.recommendedActions.length > 0 ? (
                  <div className="mt-4">
                    <p className="mb-1 text-[11px] tracking-wide text-slate-400 uppercase">Recommended actions</p>
                    <ul className="space-y-1 text-sm text-slate-300">
                      {data.summary.recommendedActions.map((action) => (
                        <li key={action}>· {action}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {data.summary.gaps.length > 0 ? (
                  <div className="mt-4">
                    <p className="mb-1 text-[11px] tracking-wide text-slate-400 uppercase">Evidence gaps</p>
                    <ul className="space-y-1 text-sm text-amber-200/80">
                      {data.summary.gaps.map((gap) => (
                        <li key={gap}>· {gap}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Spinner /> the summary step has not produced a disposition yet.
              </div>
            )}
          </Card>

          {data.summary && data.summary.evidence.length > 0 ? (
            <Card dataTour="evidence">
              <SectionTitle hint="click a claim to highlight its timeline events">Evidence</SectionTitle>
              <ul className="divide-y divide-slate-800/70">
                {data.summary.evidence.map((item, index) => {
                  const active = item.eventIds.length > 0 && item.eventIds.every((eventId) => highlighted.includes(eventId));
                  return (
                    <li key={`${item.claim}-${index}`}>
                      <button
                        type="button"
                        data-tour={index === 0 ? "evidence-claim" : undefined}
                        onClick={() => setHighlighted(active ? [] : item.eventIds)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-800/40 ${
                          active ? "bg-teal-500/10" : ""
                        }`}
                      >
                        <span className="mt-0.5 font-mono text-[11px] text-slate-500">{index + 1}</span>
                        <span className="flex-1 text-sm text-slate-200">{item.claim}</span>
                        <span className="font-mono text-[10px] text-teal-400">
                          {item.eventIds.length ? item.eventIds.join(" ") : "no linked event"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Card>
            <SectionTitle hint={`${visibleEvents.length} of ${events.length} events`}>Investigation timeline</SectionTitle>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
              {SOURCE_KEYS.map((source) => {
                const active = sourceFilter.length === 0 || sourceFilter.includes(source);
                return (
                  <button
                    key={source}
                    type="button"
                    onClick={() =>
                      setSourceFilter((current) =>
                        current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
                      )
                    }
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition ${
                      active ? SOURCE_STYLES[source] : "text-slate-500 ring-slate-700"
                    }`}
                  >
                    {SOURCE_LABELS[source]}
                  </button>
                );
              })}
              {sourceFilter.length > 0 ? (
                <button type="button" onClick={() => setSourceFilter([])} className="text-[11px] text-slate-400 underline">
                  reset
                </button>
              ) : null}
              <select
                value={entityFilter ?? ""}
                onChange={(event) => setEntityFilter(event.target.value || null)}
                className="ml-auto rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300"
              >
                <option value="">all entities</option>
                {entityOptions.map((entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ))}
              </select>
            </div>
            <ol className="max-h-[36rem] overflow-auto">
              {visibleEvents.length === 0 ? (
                <li className="px-4 py-6 text-sm text-slate-500">No events match these filters.</li>
              ) : (
                visibleEvents.map((event) => (
                  <li
                    key={event.id}
                    id={`event-${event.id}`}
                    className={`flex gap-3 border-b border-slate-800/60 px-4 py-3 transition ${
                      highlighted.includes(event.id) ? "bg-teal-500/10 ring-1 ring-teal-500/30 ring-inset" : ""
                    }`}
                  >
                    <div className="w-40 shrink-0">
                      <p className="font-mono text-[11px] text-slate-400">{formatTime(event.ts)}</p>
                      <Chip className={`mt-1 ${SOURCE_STYLES[event.source] ?? SEVERITY_STYLES.informational}`}>
                        {event.source}
                      </Chip>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-100">{event.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed break-words text-slate-400">{event.detail}</p>
                      {event.entity ? (
                        <button
                          type="button"
                          onClick={() => setEntityFilter(event.entity)}
                          className="mt-1 font-mono text-[10px] text-slate-500 hover:text-teal-300"
                        >
                          {event.entity}
                        </button>
                      ) : null}
                    </div>
                    <Chip className={SEVERITY_STYLES[event.severity] ?? SEVERITY_STYLES.informational}>
                      {event.severity}
                    </Chip>
                  </li>
                ))
              )}
            </ol>
          </Card>

          <Card dataTour="captures">
            <SectionTitle hint={`${data.screenshots.length} captures`}>Proofpoint message captures</SectionTitle>
            {data.screenshots.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">No captures collected for this investigation.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
                {data.screenshots.map((shot) => (
                  <button
                    key={shot.index}
                    type="button"
                    onClick={() => setLightbox(shot.index)}
                    className="group overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-left transition hover:border-teal-500/60"
                  >
                    <img
                      src={screenshotUrl(id, shot.index)}
                      alt={shot.label}
                      loading="lazy"
                      className="h-28 w-full object-cover object-top"
                    />
                    <div className="p-2">
                      <p className="truncate text-[11px] text-slate-300">{shot.label}</p>
                      <p className="font-mono text-[10px] text-slate-500">
                        #{shot.index + 1} · {shot.verdict}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card dataTour="collected">
            <SectionTitle hint="raw per-tool responses">Collected data</SectionTitle>
            {SOURCE_KEYS.map((source) => {
              const record = data.sources[source];
              return (
                <Collapsible
                  key={source}
                  title={
                    <span className="flex items-center gap-2">
                      <Chip className={SOURCE_STYLES[source]}>{source}</Chip>
                      {SOURCE_LABELS[source]}
                    </span>
                  }
                  hint={
                    record?.status === "ok"
                      ? `${record.recordCount ?? 0} records · ${record.durationMs ?? 0}ms${record.mocked ? " · mock" : ""}`
                      : "pending"
                  }
                >
                  {record?.data ? <Json value={record.data} /> : <p className="text-sm text-slate-500">Not collected.</p>}
                </Collapsible>
              );
            })}
            <Collapsible title="Normalized incident and entities" hint="intake">
              <Json value={{ incident: data.incident, entities: data.entities }} />
            </Collapsible>
            <Collapsible title="Structured event log" hint={`${data.logs.length} records`}>
              <Json value={data.logs} />
            </Collapsible>
          </Card>
        </div>

        <div className="space-y-6">
          <IsolatePanel data={data} onDone={load} />

          <Card>
            <SectionTitle>ServiceNow</SectionTitle>
            {data.servicenow ? (
              <div className="space-y-2 px-4 py-4 text-sm">
                <p className="font-mono text-base text-slate-100">{data.servicenow.number}</p>
                <p className="text-slate-400">
                  {data.servicenow.action === "created" ? "Created by this run" : "Existing ticket updated with a work note"}
                </p>
                <p className="text-xs text-slate-500">
                  state {data.servicenow.state} · priority {data.servicenow.priority}
                </p>
                <a
                  href={data.servicenow.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs text-teal-400 hover:text-teal-300"
                >
                  open in ServiceNow ↗
                </a>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-400">work note</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950/80 p-3 font-mono text-[10px] whitespace-pre-wrap text-slate-300">
                    {data.servicenow.workNote}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="px-4 py-4 text-sm text-slate-500">Not synced yet.</p>
            )}
          </Card>

          <Card>
            <SectionTitle>Entities</SectionTitle>
            <div className="space-y-3 px-4 py-4">
              {Object.entries(data.entities ?? {}).map(([group, values]) =>
                Array.isArray(values) && values.length > 0 ? (
                  <div key={group}>
                    <p className="mb-1 text-[10px] tracking-wider text-slate-500 uppercase">{group}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {values.map((value) => (
                        <Chip key={value} className="bg-slate-800/80 font-mono text-slate-300 ring-slate-700">
                          {value}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          </Card>

          <Card dataTour="actions">
            <SectionTitle hint={`${data.actions.length} recorded`}>Action history</SectionTitle>
            {data.actions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">No response actions taken.</p>
            ) : (
              <ul className="divide-y divide-slate-800/70">
                {data.actions.map((action, index) => (
                  <li key={`${action.ts}-${index}`} className="px-4 py-3 text-xs">
                    <p className="text-slate-200">
                      {action.action} · {action.device}
                    </p>
                    <p className="text-slate-500">
                      {formatTime(action.ts)} · approved by {action.analyst}
                    </p>
                    <p className="font-mono text-[10px] text-slate-500">{action.machineActionId}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {lightbox !== null ? (
        <Lightbox
          investigationId={id}
          screenshots={data.screenshots}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndex={setLightbox}
        />
      ) : null}
    </div>
  );
}

function IsolatePanel({ data, onDone }: { data: Investigation; onDone: () => void }) {
  const [stage, setStage] = useState<"idle" | "confirm" | "working">("idle");
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const device = data.isolate.device;

  return (
    <Card className="border-rose-900/60" dataTour="containment">
      <SectionTitle hint="requires explicit approval">Containment</SectionTitle>
      <div className="space-y-3 px-4 py-4">
        {!device ? (
          <p className="text-sm text-slate-500">No device entity to isolate.</p>
        ) : data.isolate.alreadyIsolated ? (
          <p className="text-sm text-rose-300">{device} is already isolated by this investigation.</p>
        ) : (
          <>
            <p className="text-sm text-slate-300">
              Isolate <span className="font-mono text-slate-100">{device}</span> in Microsoft Defender. Nothing is sent
              until you approve.
            </p>
            {stage === "idle" ? (
              <Button variant="danger" onClick={() => setStage("confirm")} dataTour="isolate-open">
                Isolate endpoint
              </Button>
            ) : null}
            {stage === "confirm" ? (
              <div className="space-y-3 rounded-lg border border-rose-800/60 bg-rose-950/30 p-3">
                <p className="text-xs text-rose-200">
                  This cuts {device} off the network until an administrator releases it. Confirm to send the isolate
                  request.
                </p>
                <input
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="reason recorded on the action (optional)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-rose-500"
                />
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    dataTour="isolate-confirm"
                    onClick={async () => {
                      setStage("working");
                      setProblem(null);
                      try {
                        const response = await isolateEndpoint({
                          investigationId: data.investigationId,
                          device,
                          token: data.isolate.token ?? "",
                          comment,
                        });
                        setResult(`Defender accepted the isolate request · action ${response.machineActionId}`);
                        onDone();
                      } catch (failure) {
                        setProblem(failure instanceof Error ? failure.message : String(failure));
                      } finally {
                        setStage("idle");
                      }
                    }}
                  >
                    Confirm isolation
                  </Button>
                  <Button variant="ghost" onClick={() => setStage("idle")}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            {stage === "working" ? (
              <p className="flex items-center gap-2 text-sm text-slate-300">
                <Spinner /> sending to Defender…
              </p>
            ) : null}
          </>
        )}
        {result ? <p className="text-xs text-teal-300">{result}</p> : null}
        {problem ? <p className="text-xs text-rose-300">{problem}</p> : null}
      </div>
    </Card>
  );
}

function Lightbox({
  investigationId,
  screenshots,
  index,
  onClose,
  onIndex,
}: {
  investigationId: string;
  screenshots: Investigation["screenshots"];
  index: number;
  onClose: () => void;
  onIndex: (next: number) => void;
}) {
  const position = screenshots.findIndex((shot) => shot.index === index);
  const shot = screenshots[position];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && position < screenshots.length - 1) onIndex(screenshots[position + 1].index);
      if (event.key === "ArrowLeft" && position > 0) onIndex(screenshots[position - 1].index);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [position, screenshots, onClose, onIndex]);

  if (!shot) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 p-6" onClick={onClose}>
      <div className="mb-3 flex items-center justify-between text-sm text-slate-300">
        <span className="truncate">
          {shot.label} · capture #{shot.index + 1} of {screenshots.length} · {formatTime(shot.capturedAt)}
        </span>
        <span className="text-xs text-slate-500">← → to browse · esc to close</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-4" onClick={(event) => event.stopPropagation()}>
        <Button variant="ghost" disabled={position === 0} onClick={() => onIndex(screenshots[position - 1].index)}>
          ←
        </Button>
        <img
          src={screenshotUrl(investigationId, shot.index)}
          alt={shot.label}
          className="max-h-full max-w-4xl rounded-lg ring-1 ring-slate-700"
        />
        <Button
          variant="ghost"
          disabled={position === screenshots.length - 1}
          onClick={() => onIndex(screenshots[position + 1].index)}
        >
          →
        </Button>
      </div>
    </div>
  );
}
