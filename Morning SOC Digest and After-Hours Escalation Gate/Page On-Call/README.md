Pages the on-call analyst for alerts the gate decided to escalate.

- **Trigger:** linked from [Score Alert](<../Score Alert/README.md>); newline-delimited `{ alert, result, config }` envelopes.
- **Behaviour:** writes a mock PagerDuty Events-API payload into `paged_events` (dedup key `soc-gate-<alert id>`, so a repeat page updates rather than duplicates) and posts the real page notice to Slack via `chat.postMessage`.
- **Output:** `{ "pages": [{ alertId, pageId, score, slackOk, slackError }] }`.
- Exits nonzero if any Slack notice failed, after recording the failure on the page row so the console shows it.
- **Connector:** Slack. **Volume:** `soc_state`, exclusive writer.
