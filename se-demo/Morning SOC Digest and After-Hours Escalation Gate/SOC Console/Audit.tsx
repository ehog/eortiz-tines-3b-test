import { useState } from "react";
import { Button, Card, DecisionTag, Empty, ScoreBar, SeverityTag, TierTag } from "./ui";
import { etTime, relative, type ConsoleState, type Decision } from "./api";

const FILTERS: Array<{ id: "all" | Decision; label: string }> = [
  { id: "all", label: "All" },
  { id: "page", label: "Paged" },
  { id: "deferred", label: "Deferred" },
  { id: "suppressed", label: "Suppressed" },
  { id: "bypass_business_hours", label: "Business hours" },
];

export function Audit({ state, now, busy, onReplay }: { state: ConsoleState; now: Date; busy: boolean; onReplay: (alertId: string) => void }) {
  const [filter, setFilter] = useState<"all" | Decision>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const rows = state.decisions.filter((d) => {
    if (filter !== "all" && d.decision !== filter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return [d.alert.title, d.alert.source, d.alert.user, d.alert.host, d.alert.indicator, d.reason]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  return (
    <Card
      dataTour="audit-rows"
      title="Decision audit"
      subtitle="Every alert the gate has seen, with score breakdown and reason — this is the auditable record"
      right={
        <div data-tour="audit-filters" className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by user, host, title…"
            className="w-44 rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500"
          />
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                filter === f.id ? "border-sky-500/60 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty>No decisions match this filter.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((d) => {
            const expanded = open === d.alertId;
            return (
              <li key={d.alertId} className="rounded-lg border border-slate-800 bg-slate-950/40">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : d.alertId)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <span className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{d.alert.source}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-100">{d.alert.title}</span>
                  <SeverityTag severity={d.alert.severity} />
                  <span className="w-28 shrink-0">
                    <ScoreBar score={d.score} threshold={d.threshold} />
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-200">{d.score}</span>
                  <DecisionTag decision={d.decision} />
                  {d.replayed && <span className="text-[10px] uppercase tracking-wider text-fuchsia-300">replay</span>}
                  <span className="w-20 shrink-0 text-right text-[10px] text-slate-500">{relative(d.decidedAt, now)}</span>
                </button>
                {expanded && (
                  <div className="space-y-3 border-t border-slate-800 px-3 py-3">
                    <p className="text-[11px] leading-relaxed text-slate-300">{d.reason}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        {d.breakdown.factors.map((f) => (
                          <div key={f.key}>
                            <div className="flex items-baseline justify-between text-[11px]">
                              <span className="text-slate-400">
                                {f.label} · <span className="text-slate-300">{f.value}</span>
                              </span>
                              <span className="tabular-nums text-slate-400">
                                {f.raw} × {f.weight.toFixed(2)} = {f.weighted}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                              <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${Math.min(100, f.weighted)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <dl className="space-y-1 text-[11px] text-slate-400">
                        <div className="flex justify-between gap-2">
                          <dt>Alert id</dt>
                          <dd className="truncate font-mono text-slate-300">{d.alertId}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Decided</dt>
                          <dd className="text-slate-300">{etTime(d.decidedAt)} ET</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Window</dt>
                          <dd className="text-slate-300">{d.afterHours ? "after-hours" : "business hours"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Clock mode</dt>
                          <dd className="text-slate-300">{d.clockMode.replace(/_/g, " ")}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>User · host</dt>
                          <dd className="truncate text-slate-300">
                            {d.alert.user ?? "—"} · {d.alert.host ?? "—"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Indicator</dt>
                          <dd className="truncate text-slate-300">{d.alert.indicator ?? "—"}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt>CMDB match</dt>
                          <dd className="text-slate-300">
                            {d.breakdown.asset ? (
                              <span className="flex items-center gap-2">
                                <TierTag tier={d.breakdown.asset.tier} />
                                {d.breakdown.asset.businessService}
                              </span>
                            ) : (
                              "none"
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button disabled={busy} onClick={() => onReplay(d.alertId)}>
                        Replay this alert
                      </Button>
                      <details className="flex-1">
                        <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">Raw alert JSON</summary>
                        <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-400">
                          {JSON.stringify(d.alert, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
