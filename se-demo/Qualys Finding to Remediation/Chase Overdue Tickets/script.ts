// Chases every open change past its SLA date: escalation work note, priority
// bump, and a digest of who is late. Chases a given change at most once per day
// so repeated runs do not spam the record.
import { runStage } from "./stage";
import { referenceNow } from "./pipeline-db";
import { openWrite as openSnow, listTickets, updateTicket, addWorkNote } from "./snow-db";

type Escalation = {
  sys_id: string;
  number: string;
  team: string;
  assignment_group: string;
  application: string;
  owner_note: string;
  days_overdue: number;
  previous_priority: number;
  priority: number;
  escalation_level: number;
  risk_score: number;
  risk_band: string;
  finding_count: number;
  due_date: string;
};

type ChaseResult = {
  run_id: string;
  trigger: string;
  stage: "chase";
  generated_at: string;
  as_of: string;
  escalated: Escalation[];
  skipped_already_chased: string[];
  open_count: number;
  overdue_count: number;
  notes: string[];
};

await runStage<{ as_of?: string }, ChaseResult>({
  stage: "chase",
  handler: async (input, { db, runId, invocation }) => {
    const now = referenceNow(db, input?.as_of);
    const snow = openSnow();
    const open = listTickets(snow, { state: "open" });
    const overdue = open.filter((t) => new Date(t.due_date).getTime() < now.getTime());

    const escalated: Escalation[] = [];
    const skipped: string[] = [];

    for (const ticket of overdue) {
      const daysOverdue = Math.max(
        1,
        Math.round((now.getTime() - new Date(ticket.due_date).getTime()) / 86_400_000),
      );
      if (ticket.chased_at && ticket.chased_at.slice(0, 10) === now.toISOString().slice(0, 10)) {
        skipped.push(ticket.number);
        continue;
      }
      const level = ticket.escalation_level + 1;
      const priority = Math.max(1, ticket.priority - 1);
      const note = [
        `SLA breach: this change was due ${ticket.due_date.slice(0, 10)} and is ${daysOverdue} day${
          daysOverdue === 1 ? "" : "s"
        } overdue with ${ticket.finding_count} finding${ticket.finding_count === 1 ? "" : "s"} still open.`,
        `Escalation level ${level}.`,
        priority !== ticket.priority
          ? `Priority raised from P${ticket.priority} to P${priority}.`
          : `Priority already at P${priority}.`,
        level >= 3
          ? "Third escalation: notify the application owner's management chain and record a risk acceptance if the change cannot proceed."
          : `${ticket.assignment_group} to confirm a remediation date or request a documented exception.`,
      ].join(" ");

      addWorkNote(snow, ticket.sys_id, note, "vuln-automation", now.toISOString());
      updateTicket(
        snow,
        ticket.sys_id,
        { escalation_level: level, priority, chased_at: now.toISOString() },
        now.toISOString(),
      );

      escalated.push({
        sys_id: ticket.sys_id,
        number: ticket.number,
        team: ticket.team,
        assignment_group: ticket.assignment_group,
        application: ticket.application,
        owner_note: note,
        days_overdue: daysOverdue,
        previous_priority: ticket.priority,
        priority,
        escalation_level: level,
        risk_score: ticket.risk_score,
        risk_band: ticket.risk_band,
        finding_count: ticket.finding_count,
        due_date: ticket.due_date,
      });
    }

    escalated.sort((a, b) => b.days_overdue - a.days_overdue);

    const payload: ChaseResult = {
      run_id: runId,
      trigger: invocation.trigger,
      stage: "chase",
      generated_at: now.toISOString(),
      as_of: now.toISOString(),
      escalated,
      skipped_already_chased: skipped,
      open_count: open.length,
      overdue_count: overdue.length,
      notes: [
        `${open.length} open changes, ${overdue.length} past SLA`,
        escalated.length
          ? `escalated: ${escalated.map((e) => `${e.number} (${e.days_overdue}d, ${e.team})`).join(", ")}`
          : "nothing to escalate",
        skipped.length ? `already chased today: ${skipped.join(", ")}` : "",
      ].filter(Boolean),
    };

    return {
      payload,
      count: escalated.length,
      summary:
        overdue.length === 0
          ? `no overdue changes (${open.length} open)`
          : `${escalated.length} escalated, ${skipped.length} already chased today`,
      emit: escalated.length > 0,
    };
  },
});
