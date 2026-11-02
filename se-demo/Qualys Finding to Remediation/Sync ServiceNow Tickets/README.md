Raises and maintains one open ServiceNow change per owning team and application, batching every finding
for that team onto it.

**Triggers** — linked from [Remediation Package (AI)](<../Remediation Package (AI)/README.md>); also the
route `/qualys-remediation/run/sync`, which replays the last recorded remediation payload when called
with no body. This is the last step in the chain.

**Behaviour**

- For each team and application group: find that team's open change, or create one. Priority comes from
  the batch's highest risk band (critical → P1 … low → P4) and the due date from that finding's SLA date.
- An update merges in findings not already on the change, refreshes the risk score, band and priority,
  tightens the due date if the new batch demands it — never loosens it — and appends a work note
  describing exactly what changed. A run with nothing new reports `unchanged` and writes no note, so
  re-running is safe.
- The change description is rendered by [render-ticket.ts](render-ticket.ts): a batch summary, then per
  finding the host and CVE detail, the score with its factor table and plain-language explanation, and
  the remediation package as prerequisites, copy-ready command blocks, a before/after code diff,
  validation steps and the cited Qualys evidence. An undeterminable finding renders as a callout stating
  the evidence gap instead of steps.
- The structured findings and packages are also stored on the change record, so the console can show a
  drill-down without re-running the pipeline.

**Output** — the envelope with `tickets[]`: one summary per group with `number`, `action`
(`created`, `updated` or `unchanged`), priority, risk, due date and the finding ids added.

**Storage** — `servicenow_store` and `pipeline_state`, both exclusive.

**Tests** — pinned tests cover the create path against an empty change table and the update path against
a seeded open change that is missing the new finding.
