Safety net for missed webhooks. Runs on cron `*/5 * * * *` (published version only — run it manually to test a draft).

Mounts `mock_state` read-only and looks for assets still in `pending_review` whose linked issue has already reached `Allow` or `Deny`, then emits the same decision payload as [Jira webhook](<../Jira webhook/README.md>) with `source: "jira_poll"` for [Sync asset status to Onyx](<../Sync asset status to Onyx/README.md>). No pending decisions means no output, so the chain stops.

Each poll emits at most 100 decisions, oldest first, and reads the latest status author with a grouped changelog lookup rather than a separate changelog scan per result. Remaining decisions are picked up on later scheduled runs after the sync step updates the assets. SQLite lock waits are limited to five seconds and the database is explicitly closed. Structured stderr events distinguish startup, database opening, completion counts, and failures; missing mock state is a successful no-op. The initial file check uses Node's `statSync` instead of the synchronous `Bun.file().size` getter to avoid stalling before the database opens. Only a missing or empty file is treated as absent state; other filesystem errors fail the step.

Because the sync step is idempotent, a decision arriving twice (webhook plus poll) is harmless. Logic in [script.ts](script.ts).
