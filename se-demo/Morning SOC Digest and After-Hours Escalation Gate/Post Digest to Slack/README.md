Posts the digest to Slack.

- **Trigger:** linked from [Write Digest](<../Write Digest/README.md>).
- **Behaviour:** chunks the digest text on blank lines to stay under Slack's 3,000-character section limit, then posts header, sections and a stats context block to `delivery.slackChannel`.
- **Side effect:** records `slack_status` on the digest row and a timeline entry.
- **Output:** `{ digestId, channel, ts }`. Exits nonzero on a Slack error; `retry_seconds` retries twice.
- **Connector:** Slack. **Volume:** `soc_state`, exclusive writer.
