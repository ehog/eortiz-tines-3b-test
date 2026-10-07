Mocked promotion to production. Nothing leaves this workflow.

**Trigger:** upstream [Record Intake](<../Record Intake/script.ts>) on the webhook path, or [Review Decision](<../Review Decision/script.ts>) on the human-approval path.

Promotes only when the status is `auto-approved` or `approved`. Otherwise it logs `event=deploy.skipped …` and passes the submission through untouched, so blocked and rejected artifacts still complete the audit and notification chain.

On promotion it derives a deterministic deployment id (`DEP-` plus a SHA-256 prefix of submission id and commit sha), records the target namespace, flips the ledger row to `deployed`, and logs `event=deploy.completed …`. The credential is named, never read.
