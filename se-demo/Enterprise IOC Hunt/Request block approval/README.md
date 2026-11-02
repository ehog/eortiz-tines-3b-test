Posts the block-request approval to Slack `#eortiz` (real Slack connector) when [Combine report](<../Combine report/script.ts>) found at least one indicator; exits with empty stdout otherwise.

Derives the block targets from the matched indicators — hashes become a Defender custom indicator, everything else becomes both a Zscaler URL-category entry and a Defender custom indicator — and posts a message summarizing the hits with Approve, Deny and Open report buttons. The decision links point at [Block decision](<../Block decision/script.ts>) with the hunt's approval token and are branch-aware via `_3B_BRANCH_ID`.

The pending request, the exact message text and any Slack failure are stored in `block_requests`. A Slack failure is recorded and surfaced on the report page rather than failing the step, so the pending approval is never lost.

Change the channel with `SLACK_CHANNEL` at the top of [script.ts](script.ts).
