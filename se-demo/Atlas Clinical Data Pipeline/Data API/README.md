Read-only JSON feed for the [Console](../Console/App.tsx).

**Route** — `GET /atlas/data?limit=25`, space-authenticated. See
[api.json](api.json) for the response schema.

One request returns everything the console renders: the health headline, recent
runs with their per-step timelines and structured log lines, the quality-score
trend, the rejection-reason breakdown, quarantine findings and approved
remediations.

**Storage** — the `atlas` volume mounted **read-only**, so this endpoint cannot
mutate pipeline state. A run left in `running` for more than ten minutes is
reported as `stalled` rather than rewritten. Before the first run has written the
store, it answers with an empty but well-formed payload.
