Safety net for missed webhooks. Runs on cron `*/5 * * * *` (published version only — run it manually to test a draft).

Mounts `mock_state` read-only and looks for assets still in `pending_review` whose linked issue has already reached `Allow` or `Deny`, then emits the same decision payload as [Jira webhook](<../Jira webhook/README.md>) with `source: "jira_poll"` for [Sync asset status to Onyx](<../Sync asset status to Onyx/README.md>). No pending decisions means no output, so the chain stops.

Because the sync step is idempotent, a decision arriving twice (webhook plus poll) is harmless. Logic in [script.ts](script.ts).
