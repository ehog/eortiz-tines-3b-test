`GET /api/runs/list` (space-only). Read path for [Containment Console](<../Containment Console/README.md>); mounts the `containment_state` volume read-only.

Query: `runId` for one run's detail, `limit` (1-50, default 20) for the run list.

Returns `runs` (summaries), and when `runId` is given `run`, `stages`, `attempts` (the structured log), `audit` (the audit trail) and `resume` (`resumeFrom`, `willSkip`, `allowed`). Returns an empty payload when no run has ever been recorded, and `404` for an unknown `runId`.
