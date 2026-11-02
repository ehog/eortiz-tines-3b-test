Runs when `Extract entities` fans out, or on demand via `POST /api/enrich/defender` with `{"investigationId": "..."}` — the run view's **retry** button. Both input shapes are handled.

`client.ts` holds the real API calls and the `USE_MOCK` switch; `mock.ts` holds deterministic fixtures seeded from the investigation id, with simulated latency so the parallel sources land at different times. Flip `USE_MOCK` to `false` and attach the connector to go live — no other change.

Writes `<id>/defender.json` with `{status, mocked, durationMs, recordCount, data, events, logs}`, where `events` are timeline-ready entries with stable ids. Emits a small status object on stdout to trigger `Build timeline`, and one structured JSON log line per external call to stderr. Retries on failure per `retry_seconds`.
