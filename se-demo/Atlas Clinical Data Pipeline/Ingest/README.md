Pulls one batch from three simulated partner feeds and opens the run.

**Triggered by** the hourly cron `0 * * * *` (published version only), by the
[Run pipeline](<../Run pipeline/script.ts>) route when an operator clicks *Run
pipeline* in the console, or manually.

**Input** — optional JSON: `{ "runId", "batchId", "simulate_failure" }`. Anything
missing is generated. `simulate_failure` is the chaos toggle: `none`,
`schema_drift`, `source_timeout`, `encoding_error`.

**What it does**

- Generates the three mock feeds from [lib.ts](lib.ts) — a FHIR-ish JSON bundle,
  a pipe-delimited flat file, and a legacy XML payload. All three are seeded from
  the batch id, so a batch always produces the same data.
- **Idempotency gate.** If a batch id already completed (`ok` or `degraded`), the
  run is suppressed: it writes nothing to stdout, which stops the pipeline.
- **Retries.** Each source is fetched with up to four attempts and 250/500/1000 ms
  backoff before it is declared an outage. Fetching is read-only, so replay is
  safe. `retry_seconds` in [config.toml](config.toml) additionally retries the
  whole step.
- Opens the `runs` row with status `running`, so an in-flight or crashed run is
  visible in the console.

**Output** — the run envelope (see `Envelope` in [lib.ts](lib.ts)) consumed by
[Normalize](../Normalize/script.ts).

**Storage** — the `atlas` volume, read-write with exclusive writer scheduling,
holding the SQLite store at `/storage/atlas/atlas.db`.
