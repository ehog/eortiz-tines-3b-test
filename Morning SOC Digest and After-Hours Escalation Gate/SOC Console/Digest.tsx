import { useState } from "react";
import { Button, Card, Empty, ScoreBar, SeverityTag } from "./ui";
import { etTime, relative, type ConsoleState } from "./api";

export function Digest({
  state,
  now,
  busy,
  digestRunning,
  onRun,
}: {
  state: ConsoleState;
  now: Date;
  busy: boolean;
  digestRunning: boolean;
  onRun: () => void;
}) {
  const [view, setView] = useState<"email" | "markdown" | "slack" | "meta">("email");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const digest = state.digests.find((d) => d.id === selectedId) ?? state.digests[0] ?? null;
  const pending = state.deferredQueue.filter((d) => !d.digestedAt);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-2"
          dataTour="deferred-queue"
          title="Queued for the morning digest"
          subtitle="Alerts the gate deferred instead of paging"
          right={
            <Button dataTour="run-digest" variant="primary" disabled={busy || digestRunning} onClick={onRun}>
              {digestRunning ? "Building digest…" : "Run digest now"}
            </Button>
          }
        >
          {pending.length === 0 ? (
            <Empty>Queue is empty. Deferred alerts land here until the 06:00 ET digest.</Empty>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {pending.map((d) => (
                <li key={d.alertId} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-slate-100">{d.alert.title}</span>
                    <SeverityTag severity={d.alert.severity} />
                  </div>
                  <div className="mt-1.5">
                    <ScoreBar score={d.score} threshold={state.config.pageThreshold} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {d.alert.source} · {d.alert.host ?? d.alert.user ?? "—"} · score {d.score} · queued {relative(d.queuedAt, now)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {digestRunning && (
            <p className="mt-3 animate-pulse text-[11px] text-sky-300">
              Collecting overnight activity, correlating, writing with Claude, then sending to Slack and email…
            </p>
          )}
        </Card>

        <Card
          className="lg:col-span-3"
          dataTour="digest-view"
          title={digest ? `Digest #${digest.id}` : "Digest"}
          subtitle={
            digest
              ? `${digest.itemCount} action item(s) · built ${etTime(digest.createdAt)} ET · window ${digest.windowStart ? etTime(digest.windowStart) : "—"} → ${
                  digest.windowEnd ? etTime(digest.windowEnd) : "—"
                }`
              : "No digest has been generated yet"
          }
          right={
            <div className="flex flex-wrap gap-1">
              {(["email", "markdown", "slack", "meta"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                    view === v ? "border-sky-500/60 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {v === "email" ? "Email HTML" : v === "markdown" ? "Plain text" : v === "slack" ? "Slack post" : "Run details"}
                </button>
              ))}
            </div>
          }
        >
          {!digest ? (
            <Empty>Press “Run digest now” to build one from the current queue plus 14 hours of source activity.</Empty>
          ) : view === "email" ? (
            <iframe
              title={`Digest ${digest.id} email preview`}
              srcDoc={digest.html}
              className="h-[34rem] w-full rounded-lg border border-slate-800 bg-slate-950"
            />
          ) : view === "markdown" ? (
            <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-[11px] leading-relaxed text-slate-300">
              {digest.markdown}
            </pre>
          ) : view === "slack" ? (
            <div className="max-h-[34rem] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4">
              <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300">{digest.slackText}</pre>
            </div>
          ) : (
            <dl className="space-y-2 text-[11px]">
              {[
                ["Status", digest.status],
                ["Email", digest.emailStatus ?? "not sent yet"],
                ["Slack", digest.slackStatus ?? "not sent yet"],
                ["Digest writer", digest.meta.aiStatus === "ok" ? "Claude" : `fallback (${digest.meta.aiStatus ?? "unknown"})`],
                ["Trigger", digest.meta.trigger ?? "—"],
                ["Subject", digest.meta.subject ?? "—"],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-4 border-b border-slate-800/60 pb-1">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right text-slate-300">{String(v)}</dd>
                </div>
              ))}
              <div>
                <dt className="mb-1 text-slate-500">Correlation stats</dt>
                <dd>
                  <pre className="max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-slate-400">
                    {JSON.stringify(digest.meta.stats ?? {}, null, 2)}
                  </pre>
                </dd>
              </div>
            </dl>
          )}
        </Card>
      </div>

      {state.digests.length > 1 && (
        <Card title="Recent digests">
          <ul className="flex flex-wrap gap-2">
            {state.digests.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-[11px] transition ${
                    (selectedId ?? state.digests[0]?.id) === d.id
                      ? "border-sky-500/60 bg-sky-500/10 text-sky-200"
                      : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-100"
                  }`}
                >
                  <span className="font-semibold">#{d.id}</span> · {etTime(d.createdAt)} ET · {d.itemCount} item(s)
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
