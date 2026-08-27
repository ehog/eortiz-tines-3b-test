Writes the digest with Claude and archives it.

- **Trigger:** linked from [Correlate Overnight Activity](<../Correlate Overnight Activity/README.md>).
- **Behaviour:** sends the correlated entities to Claude (`config.digest.model`) with a forced `emit_digest` tool call, so the model returns a headline, prioritised action items each with a one-line "why this matters", a watch list and an auto-closed summary. Counts, tables and the closed/suppressed list are rendered from the data rather than the model. Retries once, then falls back to a deterministic digest and marks the run so the console and footer say Claude was unavailable.
- **Side effects:** inserts into `digests` and marks the window's `deferred_queue` rows digested.
- **Output:** `{ digestId, subject, markdown, html, slackText, delivery, stats, aiStatus }`, fanned out to [Email Digest](<../Email Digest/README.md>) and [Post Digest to Slack](<../Post Digest to Slack/README.md>).
- **Connector:** Anthropic — `ANTHROPIC_BASE_URL` already ends in `/v1`. **Volume:** `soc_state`, exclusive writer.
