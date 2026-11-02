// One open change per owning team and application, batching every finding for
// that team. Re-running is idempotent: an existing open change is updated with
// whatever is new rather than duplicated.
import { runStage } from "./stage";
import { referenceNow } from "./pipeline-db";
import {
  openWrite as openSnow,
  createTicket,
  findOpenTicket,
  updateTicket,
  addWorkNote,
  priorityFor,
} from "./snow-db";
import { renderTicketBody } from "./render-ticket";
import type { Envelope, NormalizedFinding, TicketSummary } from "./types";

function shortDescription(
  band: string,
  application: string,
  count: number,
  topFinding: NormalizedFinding | undefined,
): string {
  const lead = topFinding ? topFinding.title.slice(0, 70) : "vulnerability remediation";
  return `[${band.toUpperCase()}] ${application}: ${count} finding${count === 1 ? "" : "s"} — ${lead}`;
}

await runStage<Envelope, Envelope>({
  stage: "sync",
  upstreamStage: "remediate",
  handler: async (input, { db, runId, invocation }) => {
    const findings = input?.findings ?? [];
    const groups = input?.groups ?? [];
    const byId = new Map(findings.map((f) => [f.finding_id, f]));
    const snow = openSnow();
    const now = referenceNow(db, input?.generated_at);
    const summaries: TicketSummary[] = [];

    for (const group of groups) {
      const batch = group.finding_ids
        .map((id) => byId.get(id))
        .filter((f): f is NormalizedFinding => f !== undefined);
      if (!batch.length) continue;

      const top = batch.reduce(
        (best, f) => ((f.risk?.risk_score ?? 0) > (best.risk?.risk_score ?? 0) ? f : best),
        batch[0]!,
      );
      const maxScore = top.risk?.risk_score ?? 0;
      const band = top.risk?.risk_band ?? "low";
      const priority = priorityFor(band);
      const dueDate = top.risk?.sla_due ?? new Date(now.getTime() + 30 * 86_400_000).toISOString();
      const description = renderTicketBody(group, batch, input?.run_id ?? runId);
      const short = shortDescription(band, group.application, batch.length, top);
      const payload = {
        findings: batch.map((f) => ({
          finding_id: f.finding_id,
          title: f.title,
          vuln_class: f.vuln_class,
          finding_type: f.finding_type,
          hostname: f.asset.hostname,
          cves: f.cves,
          risk_score: f.risk?.risk_score ?? 0,
          risk_band: f.risk?.risk_band ?? "low",
          sla_due: f.risk?.sla_due ?? null,
          explanation: f.risk?.explanation ?? "",
          factors: f.risk?.factors ?? [],
          remediation: f.remediation ?? null,
        })),
        run_id: input?.run_id ?? runId,
      };

      const existing = findOpenTicket(snow, group.team, group.application);

      if (!existing) {
        const created = createTicket(snow, {
          short_description: short,
          description,
          assignment_group: group.assignment_group,
          team: group.team,
          application: group.application,
          priority,
          risk_score: maxScore,
          risk_band: band,
          state: "new",
          opened_at: now.toISOString(),
          due_date: dueDate,
          finding_ids: batch.map((f) => f.finding_id),
          payload,
        });
        addWorkNote(
          snow,
          created.sys_id,
          `Opened by vulnerability automation from Qualys run ${input?.run_id ?? runId}. ${
            batch.length
          } finding${batch.length === 1 ? "" : "s"} batched; highest risk score ${maxScore} (${band}); SLA date ${dueDate.slice(
            0,
            10,
          )}. Remediation packages attached to the change description.`,
          "vuln-automation",
          now.toISOString(),
        );
        summaries.push({
          sys_id: created.sys_id,
          number: created.number,
          team: group.team,
          assignment_group: group.assignment_group,
          action: "created",
          priority,
          risk_score: maxScore,
          risk_band: band,
          due_date: dueDate,
          finding_count: batch.length,
          added_finding_ids: batch.map((f) => f.finding_id),
        });
        continue;
      }

      const previousIds: string[] = JSON.parse(existing.finding_ids);
      const mergedIds = [...new Set([...previousIds, ...batch.map((f) => f.finding_id)])];
      const added = mergedIds.filter((id) => !previousIds.includes(id));
      // Never let an update push an SLA date later than the one already committed.
      const tightestDue =
        new Date(dueDate) < new Date(existing.due_date) ? dueDate : existing.due_date;
      const riskChanged = maxScore !== existing.risk_score || band !== existing.risk_band;
      const dueChanged = tightestDue !== existing.due_date;

      if (!added.length && !riskChanged && !dueChanged) {
        summaries.push({
          sys_id: existing.sys_id,
          number: existing.number,
          team: group.team,
          assignment_group: group.assignment_group,
          action: "unchanged",
          priority: existing.priority,
          risk_score: existing.risk_score,
          risk_band: existing.risk_band,
          due_date: existing.due_date,
          finding_count: existing.finding_count,
          added_finding_ids: [],
        });
        continue;
      }

      updateTicket(
        snow,
        existing.sys_id,
        {
          short_description: shortDescription(band, group.application, mergedIds.length, top),
          description,
          priority: Math.min(existing.priority, priority),
          risk_score: Math.max(existing.risk_score, maxScore),
          risk_band: maxScore >= existing.risk_score ? band : existing.risk_band,
          due_date: tightestDue,
          finding_count: mergedIds.length,
          finding_ids: JSON.stringify(mergedIds),
          payload: JSON.stringify(payload),
        },
        now.toISOString(),
      );

      const noteParts = [`Updated from Qualys run ${input?.run_id ?? runId}.`];
      if (added.length) noteParts.push(`Added finding${added.length === 1 ? "" : "s"}: ${added.join(", ")}.`);
      if (riskChanged) {
        noteParts.push(
          `Highest risk score is now ${maxScore} (${band}), previously ${existing.risk_score} (${existing.risk_band}).`,
        );
      }
      if (dueChanged) noteParts.push(`SLA date tightened to ${tightestDue.slice(0, 10)}.`);
      addWorkNote(snow, existing.sys_id, noteParts.join(" "), "vuln-automation", now.toISOString());

      summaries.push({
        sys_id: existing.sys_id,
        number: existing.number,
        team: group.team,
        assignment_group: group.assignment_group,
        action: "updated",
        priority: Math.min(existing.priority, priority),
        risk_score: Math.max(existing.risk_score, maxScore),
        risk_band: band,
        due_date: tightestDue,
        finding_count: mergedIds.length,
        added_finding_ids: added,
      });
    }

    const created = summaries.filter((s) => s.action === "created").length;
    const updated = summaries.filter((s) => s.action === "updated").length;
    const unchanged = summaries.filter((s) => s.action === "unchanged").length;

    const payload: Envelope = {
      run_id: input?.run_id ?? runId,
      trigger: input?.trigger ?? invocation.trigger,
      stage: "sync",
      generated_at: input?.generated_at ?? new Date().toISOString(),
      findings,
      groups,
      tickets: summaries,
      notes: [
        `${created} changes created, ${updated} updated, ${unchanged} already current`,
        ...summaries.map(
          (s) =>
            `${s.number} ${s.action} for ${s.team}: ${s.finding_count} findings, P${s.priority}, due ${s.due_date.slice(0, 10)}`,
        ),
      ],
    };

    return {
      payload,
      count: summaries.length,
      summary: `${created} created, ${updated} updated, ${unchanged} unchanged`,
      emit: summaries.length > 0,
    };
  },
});
