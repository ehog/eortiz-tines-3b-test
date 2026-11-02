`POST /api/runs` (space-only). Validates the launch form, creates the run row and audit/log entries in the `containment_state` volume, then links to [Containment Orchestrator](<../Containment Orchestrator/README.md>).

Body: `alertId`, `endpoint`, `userEmail`, optional `severity` (`low`/`medium`/`high`/`critical`, default `high`) and optional `chaos` object keyed by `proofpoint_500`, `zscaler_timeout`, `defender_429`, `servicenow_400`, `isolate_fail`, each `{ enabled, mode: "fail_n" | "always", failures }`.

Responds `201` with the generated `runId` (and `mode: "start"`, which the orchestrator reads), or `400` with a list of validation errors. A rejection still reaches the orchestrator, which sees the `error` field and stops quietly.
