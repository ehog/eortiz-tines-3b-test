import { useEffect, useState } from "react";
import { api, type ReportMetrics } from "./api";
import type { Shell } from "./App";
import { Badge, Button, Card, Disclosure, Empty, Stat, Table, bandTone, shortDate, shortTime } from "./ui";

export default function ReportTab({ shell }: { shell: Shell }) {
  const { run, notify } = shell;
  const [report, setReport] = useState<{ markdown: string; metrics: ReportMetrics; as_of: string } | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const res = await api.report();
      setReport(res.report);
    } catch (err) {
      notify(`Could not load the report: ${(err as Error).message}`, "error");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const regenerate = async () => {
    const ok = await run("Regenerate report", async () => {
      await api.runReport();
      await load();
    });
    if (ok) notify("Report regenerated from the current change table.");
  };

  if (!loaded) return <Empty>Loading report…</Empty>;

  if (!report) {
    return (
      <Card
        title="Remediation progress report"
        actions={
          <Button variant="primary" busy={shell.busy === "Regenerate report"} onClick={regenerate}>
            Generate report
          </Button>
        }
      >
        <Empty>
          No report stored yet. Generate one now, or use Seed history in the header to backfill three
          weeks of change history first.
        </Empty>
      </Card>
    );
  }

  const m = report.metrics;
  const maxTrend = Math.max(1, ...m.trend.map((d) => Math.max(d.opened, d.closed)));
  const maxClass = Math.max(1, ...m.top_vuln_classes.map((c) => c.findings));

  return (
    <div className="space-y-4">
      <Card
        title="Remediation progress report"
        subtitle={`Rolling ${m.window_days}-day window, ${shortDate(m.window_start)} to ${shortDate(
          m.window_end,
        )}. Generated ${shortTime(report.as_of)}.`}
        actions={
          <Button variant="primary" busy={shell.busy === "Regenerate report"} onClick={regenerate}>
            Regenerate
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Opened" value={m.opened} hint={`${m.findings_opened} findings`} />
          <Stat label="Closed" value={m.closed} hint={`${m.findings_closed} findings`} />
          <Stat label="Open now" value={m.open_now} />
          <Stat
            label="Overdue now"
            value={m.overdue_now}
            tone={m.overdue_now ? "danger" : undefined}
            hint={m.oldest_overdue_days !== null ? `oldest ${m.oldest_overdue_days}d late` : "none late"}
          />
          <Stat
            label="Mean time to remediate"
            value={m.mttr_days === null ? "—" : `${m.mttr_days}d`}
            hint={m.mttr_sample ? `n=${m.mttr_sample}` : "no closures in window"}
          />
          <Stat
            label="SLA attainment"
            value={m.sla_attainment_pct === null ? "—" : `${m.sla_attainment_pct}%`}
            tone={
              m.sla_attainment_pct === null
                ? undefined
                : m.sla_attainment_pct >= 80
                  ? "good"
                  : "danger"
            }
            hint={`${m.closed_within_sla} in SLA, ${m.closed_late} late`}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Opened vs closed by day" subtitle="Last 14 days of change activity.">
          <div className="flex h-48 items-end gap-1.5">
            {m.trend.map((day) => (
              <div key={day.date} className="flex h-full flex-1 flex-col justify-end" title={`${day.date}: ${day.opened} opened, ${day.closed} closed`}>
                <div className="flex h-full items-end justify-center gap-0.5">
                  <div
                    className="w-1/2 rounded-t-[3px] bg-[var(--accent)]"
                    style={{ height: `${(day.opened / maxTrend) * 100}%` }}
                  />
                  <div
                    className="w-1/2 rounded-t-[3px] bg-[var(--teal)]"
                    style={{ height: `${(day.closed / maxTrend) * 100}%` }}
                  />
                </div>
                <div className="mt-1 text-center text-[9.5px] text-[var(--text-muted)]">
                  {day.date.slice(8)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[12px]">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[var(--accent)]" /> opened
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[var(--teal)]" /> closed
            </span>
          </div>
        </Card>

        <Card title="Top recurring vulnerability classes" subtitle="Findings on currently open changes.">
          {m.top_vuln_classes.length === 0 ? (
            <Empty>No open findings.</Empty>
          ) : (
            <div className="space-y-2.5">
              {m.top_vuln_classes.map((c) => (
                <div key={c.vuln_class}>
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className="font-semibold">{c.vuln_class}</span>
                    <span className="tabular-nums text-[var(--text-secondary)]">
                      {c.findings} findings · {c.changes} changes
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 w-full rounded-full bg-[var(--input-bg)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${(c.findings / maxClass) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Open changes by risk band">
          <Table head={["Band", "Open", "Closed in window"]}>
            {m.by_band.map((b) => (
              <tr key={b.band} className="border-b border-[var(--divider)]">
                <td className="px-3 py-2">
                  <Badge tone={bandTone(b.band)}>{b.band}</Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{b.open}</td>
                <td className="px-3 py-2 tabular-nums">{b.closed_in_window}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="By owning team">
          {m.by_team.length === 0 ? (
            <Empty>No changes recorded.</Empty>
          ) : (
            <Table head={["Team", "Open", "Overdue", "Closed", "Worst late"]}>
              {m.by_team.map((t) => (
                <tr key={t.team} className="border-b border-[var(--divider)]">
                  <td className="px-3 py-2 font-semibold">{t.team}</td>
                  <td className="px-3 py-2 tabular-nums">{t.open}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {t.overdue > 0 ? (
                      <span className="font-semibold text-[var(--red)]">{t.overdue}</span>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{t.closed_in_window}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {t.worst_days_overdue ? `${t.worst_days_overdue}d` : "—"}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title="Overdue changes" subtitle="Every open change past its SLA date, worst first.">
        {m.overdue_changes.length === 0 ? (
          <Empty>Nothing overdue. Fast-forward the demo clock on the Tickets tab to breach SLAs.</Empty>
        ) : (
          <Table head={["Change", "Team", "Application", "Days overdue", "Priority", "Findings", "Escalations"]}>
            {m.overdue_changes.map((o) => (
              <tr key={o.number} className="border-b border-[var(--divider)]">
                <td className="px-3 py-2 font-mono text-[12.5px] font-semibold">{o.number}</td>
                <td className="px-3 py-2">{o.team}</td>
                <td className="px-3 py-2 text-[12px] text-[var(--text-secondary)]">{o.application}</td>
                <td className="px-3 py-2 font-semibold tabular-nums text-[var(--red)]">
                  {o.days_overdue}
                </td>
                <td className="px-3 py-2 tabular-nums">P{o.priority}</td>
                <td className="px-3 py-2 tabular-nums">{o.finding_count}</td>
                <td className="px-3 py-2 tabular-nums">{o.escalation_level}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Report source" subtitle="The Markdown the scheduled report step emits on stdout.">
        <Disclosure label="Show Markdown">
          <pre className="scroll-thin max-h-[520px] overflow-auto rounded-md border border-[var(--border)] bg-[#f6f2ee] p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
            {report.markdown}
          </pre>
        </Disclosure>
      </Card>
    </div>
  );
}
