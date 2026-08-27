Scheduled ingest of Qualys detections. Emits only what is new or has changed, so a quiet scan produces
no downstream work.

**Triggers** — `cron */15 * * * *`, and the space-private route `/qualys-remediation/run/pull` for a
manual run from the console.

**Behaviour**

- Reads open detections (`Active` or `Re-Opened`) via `listDetections()` in
  [qualys-db.ts](qualys-db.ts) — the function to replace with a real Qualys Detection API call.
- Fingerprints each detection on id, QID, status, severity, CVSS and last-update time, compares against
  the `seen` table, and emits only unseen fingerprints. Editing a detection in Qualys therefore
  re-emits it.
- Writes zero bytes when nothing changed, which stops the pipeline without failing.
- `POST` with `{"force": true}` ignores the fingerprint cache and re-emits every open detection. The
  console's **Run full pipeline** button uses this so a demo always produces a full run.

**Output** — a pull envelope: `{run_id, trigger, stage, generated_at, detections[], notes[]}`, consumed
by [Normalize And Group](<../Normalize And Group/README.md>). `generated_at` is the run's reference
timestamp, and every later stage derives its SLA dates and work-note times from it.

**Storage** — `qualys_state` read-only; `pipeline_state` exclusive, for the fingerprints and the stage
record.
