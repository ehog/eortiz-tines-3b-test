// Publish: commits the batch to the persistent store and closes the run.
//
// Everything the console shows is written here in a single transaction: clean
// records (upserted on trial id + NDC so state accumulates across runs),
// rejections, quarantine findings, the structured log lines from every step,
// and the run summary. A failed run is recorded too — a failure the operator
// cannot see is worse than the failure itself.

import { type Envelope, makeLogger, openDb, persistLogs } from "./lib";

const STEP = "Publish";
const envelope: Envelope = JSON.parse(await Bun.stdin.text());
const log = makeLogger(STEP, envelope.runId);

const db = openDb();
const finishedAt = new Date();
const durationMs = finishedAt.getTime() - new Date(envelope.startedAt).getTime();

log.info("committing run", {
  status: envelope.status,
  recordsIn: envelope.counts.in,
  recordsOut: envelope.counts.out,
  duplicates: envelope.counts.duplicates,
  rejected: envelope.counts.rejected,
  quarantined: envelope.counts.quarantined,
  qualityScore: envelope.qualityScore,
  durationMs,
});

db.transaction(() => {
  if (envelope.status !== "failed") {
    const upsert = db.prepare(`
      INSERT INTO records (trial_id, ndc, run_id, condition, intervention, sponsor, phase,
                           country, enrollment, list_price_usd, effective_date, source, published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(trial_id, ndc) DO UPDATE SET
        run_id = excluded.run_id, condition = excluded.condition,
        intervention = excluded.intervention, sponsor = excluded.sponsor,
        phase = excluded.phase, country = excluded.country,
        enrollment = excluded.enrollment, list_price_usd = excluded.list_price_usd,
        effective_date = excluded.effective_date, source = excluded.source,
        published_at = excluded.published_at
    `);
    for (const r of envelope.records) {
      upsert.run(
        r.trialId, r.ndc, envelope.runId, r.condition, r.intervention, r.sponsor, r.phase,
        r.country, r.enrollment, r.listPriceUsd, r.effectiveDate, r.source,
        finishedAt.toISOString(),
      );
    }
  }

  const rej = db.prepare(
    "INSERT INTO rejections (run_id, trial_id, ndc, reason_code, detail, source) VALUES (?,?,?,?,?,?)",
  );
  for (const r of envelope.rejections) {
    rej.run(envelope.runId, r.trialId, r.ndc, r.reasonCode, r.detail, r.source);
  }

  const quar = db.prepare(
    `INSERT INTO quarantine (run_id, trial_id, ndc, reason_code, detail, matched_field, source, status)
     VALUES (?,?,?,?,?,?,?,'open')`,
  );
  for (const q of envelope.quarantine) {
    quar.run(envelope.runId, q.trialId, q.ndc, q.reasonCode, q.detail, q.matchedField, q.source);
  }

  db.run(
    `UPDATE runs SET finished_at = ?, duration_ms = ?, status = ?, records_in = ?, records_out = ?,
       duplicates = ?, rejected = ?, quarantined = ?, quality_score = ?, error = ?
     WHERE run_id = ?`,
    [
      finishedAt.toISOString(),
      durationMs,
      envelope.status,
      envelope.counts.in,
      envelope.counts.out,
      envelope.counts.duplicates,
      envelope.counts.rejected,
      envelope.counts.quarantined,
      envelope.qualityScore,
      envelope.error ? JSON.stringify(envelope.error) : null,
      envelope.runId,
    ],
  );

  persistLogs(db, [...envelope.logs, ...log.logs]);
})();

log.info("run committed", { runId: envelope.runId, status: envelope.status });
db.close();

console.log(JSON.stringify(envelope));
