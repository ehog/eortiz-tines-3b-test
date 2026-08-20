// Alert: the run's verdict.
//
// The run is fully recorded by this point, so this step exists to make the
// outcome visible where operators watch: a failed run exits non-zero, which
// surfaces the run as failed in the monitoring view and in any downstream
// alerting, with an owner-attributable payload on stderr. A degraded run warns
// but succeeds; a clean run is quiet.

import { type Envelope, makeLogger } from "./lib";

const STEP = "Alert";
const envelope: Envelope = JSON.parse(await Bun.stdin.text());
const log = makeLogger(STEP, envelope.runId);

const summary = {
  runId: envelope.runId,
  batchId: envelope.batchId,
  chaos: envelope.chaos,
  status: envelope.status,
  counts: envelope.counts,
  qualityScore: envelope.qualityScore,
};

if (envelope.status === "failed") {
  log.error("PIPELINE RUN FAILED", {
    ...summary,
    owner: envelope.error?.owner,
    source: envelope.error?.source,
    field: envelope.error?.field,
    record: envelope.error?.recordId,
    changedVsLastGoodRun: envelope.error?.changedVsLastGoodRun,
    message: envelope.error?.message,
    triage: envelope.triage,
  });
  console.error(
    `\nOwner: ${envelope.error?.owner}\nSource: ${envelope.error?.source}\nField: ${
      envelope.error?.field ?? "n/a"
    }\nRecord: ${envelope.error?.recordId ?? "n/a"}\nWhat changed: ${
      envelope.error?.changedVsLastGoodRun ?? "n/a"
    }\nTriage: ${envelope.triage?.rootCause ?? "n/a"} — ${envelope.triage?.note ?? ""}\n`,
  );
  process.exit(1);
}

if (envelope.status === "degraded") {
  log.warn("PIPELINE RUN DEGRADED", { ...summary, triage: envelope.triage });
} else {
  log.info("pipeline run clean", summary);
}

console.log(JSON.stringify(summary));
