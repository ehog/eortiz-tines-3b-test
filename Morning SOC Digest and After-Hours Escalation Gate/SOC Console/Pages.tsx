import { Button, Card, Empty } from "./ui";
import { etTime, relative, type ConsoleState } from "./api";

const STATUS_STYLES: Record<string, string> = {
  triggered: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  acknowledged: "border-amber-500/50 bg-amber-500/15 text-amber-200",
  resolved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
};

export function Pages({
  state,
  now,
  busy,
  onAck,
  onResolve,
  onClear,
}: {
  state: ConsoleState;
  now: Date;
  busy: boolean;
  onAck: (id: string) => void;
  onResolve: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <Card
      dataTour="pages-inbox"
      title="On-call pages"
      subtitle="Pages created by the gate, simulated from PagerDuty, alongside the real Slack notice that was posted"
      right={
        <Button variant="danger" disabled={busy || state.pages.length === 0} onClick={onClear}>
          Clear inbox
        </Button>
      }
    >
      {state.pages.length === 0 ? (
        <Empty>No pages yet. Anything scoring at or above {state.config.pageThreshold} after hours lands here.</Empty>
      ) : (
        <ul className="space-y-3">
          {state.pages.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLES[p.status] ?? STATUS_STYLES.triggered}`}>
                  {p.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{p.title}</span>
                <span className="text-xs font-semibold tabular-nums text-rose-200">score {p.score}</span>
                <span className="text-[10px] text-slate-500">
                  {etTime(p.createdAt)} ET · {relative(p.createdAt, now)}
                </span>
              </div>

              <div className="mt-2 grid gap-3 text-[11px] text-slate-400 sm:grid-cols-3">
                <div>
                  <span className="text-slate-500">Paged</span>
                  <div className="text-slate-200">{p.onCall}</div>
                </div>
                <div>
                  <span className="text-slate-500">Dedup key</span>
                  <div className="truncate font-mono text-slate-300">{p.payload?.dedup_key ?? p.id}</div>
                </div>
                <div>
                  <span className="text-slate-500">Slack notice</span>
                  <div className={p.slackError ? "text-rose-300" : "text-emerald-300"}>
                    {p.slackError ? `failed: ${p.slackError}` : `posted to ${p.slackChannel} (ts ${p.slackTs ?? "—"})`}
                  </div>
                </div>
              </div>

              <div data-tour="page-actions" className="mt-3 flex flex-wrap items-center gap-2">
                <Button disabled={busy || p.status !== "triggered"} onClick={() => onAck(p.id)}>
                  Acknowledge
                </Button>
                <Button disabled={busy || p.status === "resolved"} onClick={() => onResolve(p.id)}>
                  Resolve
                </Button>
                {p.ackedAt && <span className="text-[10px] text-slate-500">acked {relative(p.ackedAt, now)}</span>}
                {p.resolvedAt && <span className="text-[10px] text-slate-500">resolved {relative(p.resolvedAt, now)}</span>}
                <details className="ml-auto">
                  <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">Payload simulated from PagerDuty</summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-400">
                    {JSON.stringify(p.payload, null, 2)}
                  </pre>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
