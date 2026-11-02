The console's trigger endpoint.

**Route** — `POST /atlas/run`, space-authenticated. See [api.json](api.json) for
the contract.

Mints the run id and batch id, validates the chaos toggle
(`none` | `schema_drift` | `source_timeout` | `encoding_error`), answers the
browser with `202 Accepted`, and hands the trigger payload to
[Ingest](../Ingest/script.ts) — this step's response body *is* Ingest's stdin,
so the pipeline continues after the operator's request has already returned.
