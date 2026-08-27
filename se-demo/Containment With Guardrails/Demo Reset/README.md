`POST /api/demo/reset` (space-only). Clears demo state in the `containment_state` volume so a run can be repeated cleanly.

Body: `scope` — `all` (default) clears run history, stage state, logs, audit trail and simulated ServiceNow/Defender state; `mocks` clears only the simulated ticket, isolation and chaos counter state and keeps the run history.

Responds `200` with counts of what was cleared.
