import { Card, DECISION_LABELS, Empty, Stat } from "./ui";
import { etTime, relative, type ConsoleState, type Decision } from "./api";

const KIND_COLORS: Record<string, string> = {
  "decision:page": "bg-rose-500",
  "decision:deferred": "bg-amber-400",
  "decision:suppressed": "bg-slate-500",
  "decision:bypass_business_hours": "bg-teal-400",
  page: "bg-rose-400",
  "page:update": "bg-sky-400",
  digest: "bg-emerald-400",
  "digest:email": "bg-emerald-300",
  "digest:slack": "bg-emerald-300",
  config: "bg-violet-400",
  clock: "bg-violet-300",
  cmdb: "bg-sky-300",
  replay: "bg-fuchsia-400",
  reset: "bg-slate-400",
};

function kindLabel(kind: string): string {
  if (kind.startsWith("decision:")) return DECISION_LABELS[kind.slice(9) as Decision] ?? kind;
  return kind.replace(/[:_]/g, " ");
}

export function LiveOps({ state, now }: { state: ConsoleState; now: Date }) {
  const c = state.counters;
  const recent = state.decisions.slice(0, 6);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Alerts received" value={c.received} />
        <Stat label="Paged" value={c.paged} tone="rose" />
        <Stat label="Deferred" value={c.deferred} tone="amber" />
        <Stat label="Suppressed" value={c.suppressed} />
        <Stat label="Business hours" value={c.bypassed} tone="teal" />
        <Stat label="Queued for digest" value={c.pendingDeferred} tone="sky" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-3"
          title="Gate event timeline"
          subtitle="Every decision, page, config change and digest, newest first"
        >
          {state.timeline.length === 0 ? (
            <Empty>No gate activity yet. Send a scenario from the Alert injector tab.</Empty>
          ) : (
            <ol className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
              {state.timeline.map((event) => (
                <li key={event.id} className="flex gap-3 rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_COLORS[event.kind] ?? "bg-slate-500"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{kindLabel(event.kind)}</span>
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {etTime(event.at)} · {relative(event.at, now)}
                      </span>
                    </div>
                    <p className="truncate text-xs text-slate-200">{event.message}</p>
                    {typeof event.meta.score === "number" && (
                      <p className="text-[10px] text-slate-500">
                        score {event.meta.score}
                        {typeof event.meta.threshold === "number" ? ` / threshold ${event.meta.threshold}` : ""}
                        {event.meta.replayed ? " · replay" : ""}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card title="Most recent decisions" subtitle="Score against the live threshold">
            {recent.length === 0 ? (
              <Empty>Nothing scored yet.</Empty>
            ) : (
              <ul className="space-y-3">
                {recent.map((d) => (
                  <li key={d.alertId}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs text-slate-200">{d.alert.title}</span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-300">{d.score}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">{d.alert.source}</span>
                      <span className="text-[10px] text-slate-500">{DECISION_LABELS[d.decision]}</span>
                      <span className="ml-auto text-[10px] text-slate-500">{relative(d.decidedAt, now)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Open pages" subtitle="Mock PagerDuty inbox">
            {state.pages.filter((p) => p.status === "triggered").length === 0 ? (
              <Empty>No unacknowledged pages.</Empty>
            ) : (
              <ul className="space-y-2">
                {state.pages
                  .filter((p) => p.status === "triggered")
                  .slice(0, 5)
                  .map((p) => (
                    <li key={p.id} className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs text-rose-100">{p.title}</span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-rose-200">{p.score}</span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {p.id} · {p.onCall} · {relative(p.createdAt, now)}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
