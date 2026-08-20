Commits the batch to the persistent store and closes the run.

**Triggered by** [PHI guard](<../PHI guard/script.ts>).

Everything the console shows is written here in one transaction:

- clean records, upserted on `(trial_id, ndc)` so the canonical store accumulates
  across runs
- rejections and PHI quarantine findings
- the structured log lines emitted by every step of the run
- the run summary: counts in/out, duplicates, rejected, quarantined, quality
  score, duration and status

A failed run is recorded too — with no records published — because a failure the
operator cannot see is worse than the failure itself.

**Storage** — the `atlas` volume, read-write with exclusive writer scheduling.
