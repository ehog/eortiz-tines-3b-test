// Rolling-window remediation metrics computed from the ServiceNow change table.
import type { TicketRow } from "./snow-db";

const DAY = 86_400_000;

export type ReportMetrics = {
  window_days: number;
  window_start: string;
  window_end: string;
  opened: number;
  closed: number;
  open_now: number;
  overdue_now: number;
  findings_opened: number;
  findings_closed: number;
  mttr_days: number | null;
  mttr_sample: number;
  sla_attainment_pct: number | null;
  closed_within_sla: number;
  closed_late: number;
  oldest_overdue_days: number | null;
  by_band: { band: string; open: number; closed_in_window: number }[];
  by_team: {
    team: string;
    open: number;
    overdue: number;
    closed_in_window: number;
    worst_days_overdue: number;
  }[];
  top_vuln_classes: { vuln_class: string; findings: number; changes: number }[];
  trend: { date: string; opened: number; closed: number }[];
  overdue_changes: {
    number: string;
    team: string;
    application: string;
    days_overdue: number;
    priority: number;
    risk_score: number;
    finding_count: number;
    escalation_level: number;
  }[];
};

const BANDS = ["critical", "high", "medium", "low"];

function inWindow(iso: string | null, start: number, end: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= start && t <= end;
}

function findingsOf(row: TicketRow): { vuln_class?: string }[] {
  try {
    const parsed = JSON.parse(row.payload) as { findings?: { vuln_class?: string }[] };
    return parsed.findings ?? [];
  } catch {
    return [];
  }
}

export function computeMetrics(
  tickets: TicketRow[],
  now: Date,
  windowDays = 7,
  trendDays = 14,
): ReportMetrics {
  const end = now.getTime();
  const start = end - windowDays * DAY;

  const opened = tickets.filter((t) => inWindow(t.opened_at, start, end));
  const closed = tickets.filter((t) => t.state === "closed" && inWindow(t.closed_at, start, end));
  const openNow = tickets.filter((t) => t.state !== "closed");
  const overdueNow = openNow.filter((t) => new Date(t.due_date).getTime() < end);

  const durations = closed.map(
    (t) => (new Date(t.closed_at!).getTime() - new Date(t.opened_at).getTime()) / DAY,
  );
  const mttr = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
    : null;

  const withinSla = closed.filter(
    (t) => new Date(t.closed_at!).getTime() <= new Date(t.due_date).getTime(),
  );
  const slaAttainment = closed.length
    ? Math.round((withinSla.length / closed.length) * 1000) / 10
    : null;

  const teamNames = [...new Set([...openNow, ...closed].map((t) => t.team))].sort();
  const byTeam = teamNames.map((team) => {
    const teamOpen = openNow.filter((t) => t.team === team);
    const teamOverdue = teamOpen.filter((t) => new Date(t.due_date).getTime() < end);
    const worst = teamOverdue.reduce(
      (max, t) => Math.max(max, Math.round((end - new Date(t.due_date).getTime()) / DAY)),
      0,
    );
    return {
      team,
      open: teamOpen.length,
      overdue: teamOverdue.length,
      closed_in_window: closed.filter((t) => t.team === team).length,
      worst_days_overdue: worst,
    };
  });
  byTeam.sort((a, b) => b.overdue - a.overdue || b.open - a.open);

  const classCounts = new Map<string, { findings: number; changes: number }>();
  for (const t of openNow) {
    const seen = new Set<string>();
    for (const f of findingsOf(t)) {
      const key = f.vuln_class ?? "Unclassified";
      const entry = classCounts.get(key) ?? { findings: 0, changes: 0 };
      entry.findings += 1;
      if (!seen.has(key)) {
        entry.changes += 1;
        seen.add(key);
      }
      classCounts.set(key, entry);
    }
  }
  const topClasses = [...classCounts.entries()]
    .map(([vuln_class, v]) => ({ vuln_class, ...v }))
    .sort((a, b) => b.findings - a.findings || a.vuln_class.localeCompare(b.vuln_class))
    .slice(0, 6);

  const trend: ReportMetrics["trend"] = [];
  for (let i = trendDays - 1; i >= 0; i -= 1) {
    const dayEnd = end - i * DAY;
    const dayStart = dayEnd - DAY;
    trend.push({
      date: new Date(dayEnd).toISOString().slice(0, 10),
      opened: tickets.filter((t) => inWindow(t.opened_at, dayStart, dayEnd)).length,
      closed: tickets.filter((t) => t.state === "closed" && inWindow(t.closed_at, dayStart, dayEnd))
        .length,
    });
  }

  const overdueChanges = overdueNow
    .map((t) => ({
      number: t.number,
      team: t.team,
      application: t.application,
      days_overdue: Math.round((end - new Date(t.due_date).getTime()) / DAY),
      priority: t.priority,
      risk_score: t.risk_score,
      finding_count: t.finding_count,
      escalation_level: t.escalation_level,
    }))
    .sort((a, b) => b.days_overdue - a.days_overdue);

  return {
    window_days: windowDays,
    window_start: new Date(start).toISOString(),
    window_end: new Date(end).toISOString(),
    opened: opened.length,
    closed: closed.length,
    open_now: openNow.length,
    overdue_now: overdueNow.length,
    findings_opened: opened.reduce((sum, t) => sum + t.finding_count, 0),
    findings_closed: closed.reduce((sum, t) => sum + t.finding_count, 0),
    mttr_days: mttr,
    mttr_sample: durations.length,
    sla_attainment_pct: slaAttainment,
    closed_within_sla: withinSla.length,
    closed_late: closed.length - withinSla.length,
    oldest_overdue_days: overdueChanges.length ? overdueChanges[0]!.days_overdue : null,
    by_band: BANDS.map((band) => ({
      band,
      open: openNow.filter((t) => t.risk_band === band).length,
      closed_in_window: closed.filter((t) => t.risk_band === band).length,
    })),
    by_team: byTeam,
    top_vuln_classes: topClasses,
    trend,
    overdue_changes: overdueChanges,
  };
}

export function renderMarkdown(m: ReportMetrics): string {
  const lines: string[] = [];
  lines.push(
    `# Vulnerability remediation progress`,
    "",
    `Window: ${m.window_start.slice(0, 10)} to ${m.window_end.slice(0, 10)} (${m.window_days} days)`,
    "",
    "## Headline",
    "",
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Changes opened | ${m.opened} (${m.findings_opened} findings) |`,
    `| Changes closed | ${m.closed} (${m.findings_closed} findings) |`,
    `| Open now | ${m.open_now} |`,
    `| Overdue now | ${m.overdue_now} |`,
    `| Mean time to remediate | ${m.mttr_days === null ? "no closures in window" : `${m.mttr_days} days (n=${m.mttr_sample})`} |`,
    `| SLA attainment | ${
      m.sla_attainment_pct === null
        ? "no closures in window"
        : `${m.sla_attainment_pct}% (${m.closed_within_sla} within SLA, ${m.closed_late} late)`
    } |`,
    `| Oldest overdue change | ${m.oldest_overdue_days === null ? "none" : `${m.oldest_overdue_days} days`} |`,
    "",
  );

  lines.push("## Open changes by risk band", "", "| Band | Open | Closed in window |", "| --- | --- | --- |");
  for (const b of m.by_band) {
    lines.push(`| ${b.band} | ${b.open} | ${b.closed_in_window} |`);
  }
  lines.push("");

  lines.push(
    "## By owning team",
    "",
    "| Team | Open | Overdue | Closed in window | Worst days overdue |",
    "| --- | --- | --- | --- | --- |",
  );
  if (!m.by_team.length) lines.push("| _no changes_ | 0 | 0 | 0 | 0 |");
  for (const t of m.by_team) {
    lines.push(
      `| ${t.team} | ${t.open} | ${t.overdue} | ${t.closed_in_window} | ${
        t.worst_days_overdue || "-"
      } |`,
    );
  }
  lines.push("");

  lines.push(
    "## Top recurring vulnerability classes (open changes)",
    "",
    "| Class | Findings | Changes affected |",
    "| --- | --- | --- |",
  );
  if (!m.top_vuln_classes.length) lines.push("| _none_ | 0 | 0 |");
  for (const c of m.top_vuln_classes) {
    lines.push(`| ${c.vuln_class} | ${c.findings} | ${c.changes} |`);
  }
  lines.push("");

  if (m.overdue_changes.length) {
    lines.push(
      "## Overdue changes",
      "",
      "| Change | Team | Application | Days overdue | Priority | Findings | Escalations |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const o of m.overdue_changes) {
      lines.push(
        `| ${o.number} | ${o.team} | ${o.application} | ${o.days_overdue} | P${o.priority} | ${o.finding_count} | ${o.escalation_level} |`,
      );
    }
    lines.push("");
  } else {
    lines.push("## Overdue changes", "", "None. Every open change is inside its SLA date.", "");
  }

  lines.push("## Opened vs closed by day", "", "| Date | Opened | Closed |", "| --- | --- | --- |");
  for (const d of m.trend) lines.push(`| ${d.date} | ${d.opened} | ${d.closed} |`);
  lines.push("");

  return lines.join("\n");
}
