Chases every open change that has passed its SLA date.

**Triggers** — `cron 0 * * * *`, and the route `/qualys-remediation/run/chase` for the console's **Run
overdue chase** button.

**Behaviour**

- Compares each open change's due date against the demo clock. For each breach it adds an escalation work
  note stating the due date, days overdue and findings still open, increments the escalation level, and
  raises priority by one step (never past P1). At escalation level 3 the note asks for the management
  chain to be notified or a documented risk acceptance to be recorded.
- Chases a given change at most once per day, so the hourly schedule does not spam the record.
  Already-chased changes are reported in `skipped_already_chased`.
- Emits an escalation digest, or zero bytes when nothing is overdue.
- Accepts `{"as_of": "<ISO timestamp>"}` to evaluate SLAs as of a given moment instead of now.

**Storage** — `servicenow_store`, `pipeline_state`, and `audit`, all exclusive. Ticket notes and escalation updates are committed in one SQLite transaction instead of two disk commits per ticket. The ticket database is explicitly closed afterward. The 60-second timeout remains unchanged.

Structured stderr events identify startup, loaded ticket counts, skips, completion, and failures. Successful escalations append identifier-only audit records to daily JSONL files in `audit`. Failed executions discard volume changes, so stderr remains the source for failed-run diagnostics. Audit storage requires operational retention before reaching the 2 GB volume limit.

This step updates the local mock ServiceNow store; it makes no external API calls. The route is space-member-only. A passing empty-store draft run does not establish performance against Live data; copy Live storage through Draft storage to reproduce that workload.

**Tests** — a pinned test seeds one overdue change not yet chased today, one overdue change already
chased today, and one change inside SLA, and asserts exactly one escalation and one skip.
