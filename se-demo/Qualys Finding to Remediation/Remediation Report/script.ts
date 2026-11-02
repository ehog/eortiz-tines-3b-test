// Weekly remediation progress report. Emits Markdown on stdout and stores both
// the Markdown and the metrics in pipeline state so the console can render them.
import { runStage } from "./stage";
import { referenceNow, setConfig } from "./pipeline-db";
import { openRead as openSnow, listTickets } from "./snow-db";
import { computeMetrics, renderMarkdown, type ReportMetrics } from "./metrics";

type ReportPayload = {
  run_id: string;
  trigger: string;
  stage: "report";
  generated_at: string;
  as_of: string;
  metrics: ReportMetrics;
  markdown: string;
};

await runStage<{ window_days?: number; as_of?: string }, ReportPayload>({
  stage: "report",
  handler: async (input, { db, runId, invocation }) => {
    const now = referenceNow(db, input?.as_of);
    const windowDays = Number.isFinite(Number(input?.window_days))
      ? Math.max(1, Math.min(90, Number(input?.window_days)))
      : 7;
    const tickets = listTickets(openSnow(), { state: "all" });
    const metrics = computeMetrics(tickets, now, windowDays);
    const markdown = renderMarkdown(metrics);

    const payload: ReportPayload = {
      run_id: runId,
      trigger: invocation.trigger,
      stage: "report",
      generated_at: now.toISOString(),
      as_of: now.toISOString(),
      metrics,
      markdown,
    };
    setConfig(db, "latest_report", JSON.stringify(payload));

    return {
      payload,
      raw: markdown,
      count: tickets.length,
      summary: `${metrics.opened} opened, ${metrics.closed} closed, ${metrics.overdue_now} overdue, MTTR ${
        metrics.mttr_days ?? "n/a"
      } days`,
    };
  },
});
