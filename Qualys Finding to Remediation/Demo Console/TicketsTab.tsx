import { useCallback, useEffect, useState } from "react";
import { api, type Ticket } from "./api";
import type { Shell } from "./App";
import { Badge, Button, Card, Disclosure, Empty, Stat, bandTone, shortDate, shortTime } from "./ui";

type BatchedFinding = {
  finding_id?: string;
  title?: string;
  vuln_class?: string;
  hostname?: string;
  risk_score?: number;
  risk_band?: string;
  explanation?: string;
  remediation?: { summary?: string; required_fix?: string; determinable?: boolean } | null;
};

function stateTone(ticket: Ticket): string {
  if (ticket.state === "closed") return "success";
  if (ticket.overdue) return "critical";
  return "info";
}

export default function TicketsTab({ shell }: { shell: Shell }) {
  const { run, notify, state, refreshState } = shell;
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [advanceDays, setAdvanceDays] = useState(5);

  const load = useCallback(async () => {
    try {
      const res = await api.tickets();
      setTickets(res.result);
      setAsOf(res.as_of);
    } catch (err) {
      notify(`Could not load changes: ${(err as Error).message}`, "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>, message?: string) => {
    const ok = await run(label, async () => {
      await fn();
      await load();
    });
    if (ok) notify(message ?? `${label} done.`);
  };

  const visible = (tickets ?? []).filter((t) => showClosed || t.state !== "closed");
  const byTeam = new Map<string, Ticket[]>();
  for (const ticket of visible) {
    const list = byTeam.get(ticket.team) ?? [];
    list.push(ticket);
    byTeam.set(ticket.team, list);
  }
  const teams = [...byTeam.entries()].sort(
    (a, b) =>
      b[1].filter((t) => t.overdue).length - a[1].filter((t) => t.overdue).length ||
      Math.min(...a[1].map((t) => t.priority)) - Math.min(...b[1].map((t) => t.priority)),
  );

  const open = (tickets ?? []).filter((t) => t.state !== "closed");
  const overdue = open.filter((t) => t.overdue);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open changes" value={open.length} hint={`${tickets?.length ?? 0} total`} />
        <Stat
          label="Overdue"
          value={overdue.length}
          tone={overdue.length ? "danger" : undefined}
          hint={overdue.length ? `worst ${Math.max(...overdue.map((t) => Math.abs(t.days_to_due ?? 0)))} days late` : "all inside SLA"}
        />
        <Stat
          label="Batched findings"
          value={open.reduce((sum, t) => sum + t.finding_count, 0)}
          hint="across open changes"
        />
        <Stat
          label="Demo clock"
          value={state ? `+${state.clock_offset_days}d` : "—"}
          hint={shortTime(asOf)}
        />
      </div>

      <Card anchorId="tickets-controls"
        title="Demo controls"
        subtitle="Fast-forward the clock to breach SLAs, then chase the overdue changes."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px]">
            <span className="block font-semibold text-[var(--text-secondary)]">Advance clock by</span>
            <div className="mt-1 flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={90}
                value={advanceDays}
                onChange={(e) => setAdvanceDays(Number(e.target.value))}
                className="w-20 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 tabular-nums"
              />
              <span className="text-[12px] text-[var(--text-secondary)]">days</span>
            </div>
          </label>
          <Button
            variant="primary"
            busy={shell.busy === "Advance clock"}
            onClick={() =>
              void act(
                "Advance clock",
                () => api.advanceClock(advanceDays),
                `Demo clock advanced ${advanceDays} days.`,
              )
            }
          >
            Fast-forward
          </Button>
          <Button
            busy={shell.busy === "Reset clock"}
            onClick={() => void act("Reset clock", () => api.setClock(0), "Demo clock reset to today.")}
          >
            Back to today
          </Button>
          <Button
            variant="secondary"
            busy={shell.busy === "Run overdue chase"}
            onClick={() =>
              void act("Run overdue chase", () => api.runChase(), "Overdue chase complete.")
            }
          >
            Run overdue chase
          </Button>
          <Button variant="ghost" onClick={() => void Promise.all([load(), refreshState()])}>
            Refresh
          </Button>
          <label className="ml-auto flex items-center gap-2 text-[12px] font-semibold">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            Show closed changes
          </label>
        </div>
      </Card>

      {!tickets ? (
        <Empty>Loading changes…</Empty>
      ) : teams.length === 0 ? (
        <Empty>
          No changes yet. Run the pipeline from the Pipeline tab, or use Seed history in the header.
        </Empty>
      ) : (
        teams.map(([team, list]) => (
          <Card anchorId="tickets-table"
            key={team}
            title={team}
            subtitle={`${list.length} change${list.length === 1 ? "" : "s"} · ${list.filter((t) => t.overdue).length} overdue · ${list[0]!.assignment_group}`}
          >
            <div className="space-y-3">
              {list
                .slice()
                .sort((a, b) => a.priority - b.priority || a.due_date.localeCompare(b.due_date))
                .map((ticket) => (
                  <TicketCard
                    key={ticket.sys_id}
                    ticket={ticket}
                    busy={shell.busy === `Close ${ticket.number}`}
                    onClose={() =>
                      void act(
                        `Close ${ticket.number}`,
                        () => api.closeTicket(ticket.sys_id),
                        `${ticket.number} closed.`,
                      )
                    }
                  />
                ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  busy,
  onClose,
}: {
  ticket: Ticket;
  busy: boolean;
  onClose: () => void;
}) {
  const batched = (ticket.findings?.findings ?? []) as BatchedFinding[];
  const days = ticket.days_to_due ?? 0;

  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--card-solid)]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold">{ticket.number}</span>
            <Badge tone={stateTone(ticket)}>
              {ticket.state === "closed" ? "closed" : ticket.overdue ? "overdue" : ticket.state}
            </Badge>
            <Badge tone={bandTone(ticket.risk_band)}>
              {ticket.risk_band} · {ticket.risk_score}
            </Badge>
            <Badge tone="neutral">P{ticket.priority}</Badge>
            {ticket.escalation_level > 0 && (
              <Badge tone="high">escalated ×{ticket.escalation_level}</Badge>
            )}
          </div>
          <div className="mt-1.5 text-[13px]">{ticket.short_description}</div>
          <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
            {ticket.application} · {ticket.finding_count} finding
            {ticket.finding_count === 1 ? "" : "s"} · opened {shortDate(ticket.opened_at)}
            {ticket.closed_at && ` · closed ${shortDate(ticket.closed_at)}`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] font-semibold text-[var(--text-secondary)]">SLA due</div>
          <div className="text-[14px] font-bold tabular-nums">{shortDate(ticket.due_date)}</div>
          <div
            className={`text-[12px] font-semibold tabular-nums ${
              ticket.overdue ? "text-[var(--red)]" : "text-[var(--green)]"
            }`}
          >
            {ticket.state === "closed"
              ? days >= 0
                ? `closed ${Math.abs(days)}d early`
                : `closed ${Math.abs(days)}d late`
              : days >= 0
                ? `${days}d remaining`
                : `${Math.abs(days)}d overdue`}
          </div>
          {ticket.state !== "closed" && (
            <Button className="mt-2" busy={busy} onClick={onClose}>
              Close change
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-[var(--divider)] px-4 py-3">
        <Disclosure label={`Batched findings (${batched.length})`}>
          {batched.length === 0 ? (
            <p className="text-[12px] text-[var(--text-secondary)]">
              No finding detail stored on this change.
            </p>
          ) : (
            <div className="space-y-2">
              {batched.map((f, i) => (
                <div
                  key={f.finding_id ?? i}
                  className="rounded-md border border-[var(--border)] bg-[var(--card-bg)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[12.5px]">{f.finding_id}</span>
                    {f.risk_band && <Badge tone={bandTone(f.risk_band)}>{f.risk_band} · {f.risk_score}</Badge>}
                    {f.vuln_class && <Badge tone="neutral">{f.vuln_class}</Badge>}
                    {f.hostname && (
                      <span className="text-[12px] text-[var(--text-secondary)]">{f.hostname}</span>
                    )}
                  </div>
                  <div className="mt-1 text-[12.5px]">{f.title}</div>
                  {f.remediation?.summary && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                      {f.remediation.determinable === false ? "⚠ " : ""}
                      {f.remediation.summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Disclosure>

        <Disclosure label={`Work notes (${ticket.work_notes.length})`}>
          <ol className="space-y-2">
            {ticket.work_notes.map((note, i) => (
              <li key={i} className="border-l-2 border-[var(--accent)]/40 pl-3">
                <div className="text-[11.5px] text-[var(--text-secondary)]">
                  {shortTime(note.created_at)} · {note.author}
                </div>
                <div className="text-[12.5px] leading-relaxed">{note.note}</div>
              </li>
            ))}
          </ol>
        </Disclosure>

        <Disclosure label="Change description (as ServiceNow would show it)">
          <pre className="scroll-thin max-h-[420px] overflow-auto rounded-md border border-[var(--border)] bg-[#f6f2ee] p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
            {ticket.description}
          </pre>
        </Disclosure>
      </div>
    </div>
  );
}
