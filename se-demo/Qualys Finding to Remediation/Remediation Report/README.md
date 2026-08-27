Rolling remediation-progress report over the ServiceNow change table.

**Triggers** — `cron 0 8 * * *`, and the route `/qualys-remediation/run/report` for the console's
regenerate button.

**Behaviour** — [metrics.ts](metrics.ts) computes, over a rolling window (7 days by default): changes and
findings opened and closed, currently open and overdue counts, mean time to remediate across closures in
the window, SLA attainment split into on-time and late, the oldest overdue change, open and closed counts
per risk band, a per-team breakdown with worst days overdue, the top recurring vulnerability classes
across open changes, a 14-day opened-versus-closed trend, and every overdue change.

Accepts `{"window_days": n}` and `{"as_of": "<ISO timestamp>"}` to report over a different window or as of
a different moment.

**Output** — Markdown on stdout, so a scheduled run reads as a report. The same run stores the Markdown
and the structured metrics in `pipeline_state` under `latest_report`, which is what the console's Report
tab renders.

**Storage** — `servicenow_store` read-only; `pipeline_state` exclusive, for the stored report and the
stage record.

**Tests** — a pinned test seeds a change table covering on-time closures, a late closure, an overdue open
change and one inside SLA, and asserts the resulting counts, MTTR and SLA attainment.
