Manual delivery trigger for an already-generated digest.

**Trigger** — `POST /api/send-digest`, space members only. Called by the console's Notifications card ("Send email now", "Send to Slack now", "Send both").

**Input** — JSON body: `{ "digestId"?: number, "channels"?: ["email" | "slack"], "force"?: boolean }`. `digestId` defaults to the newest digest, `channels` defaults to both, and `force` defaults to `true` so a manual send goes out even when that channel's notification toggle is off.

**Output** — the same digest payload [Write Digest](<../Write Digest/README.md>) emits (`digestId`, `subject`, `markdown`, `html`, `slackText`, `delivery`, `stats`) plus `channels`, `force` and `trigger: "manual_send"`. It links to [Email Digest](<../Email Digest/README.md>) and [Post Digest to Slack](<../Post Digest to Slack/README.md>); each of those exits without sending when its channel is not listed.

The route has no output step, so callers get `202 Accepted`; the console polls `/api/console` for the resulting delivery status. Exits nonzero when no digest exists yet or `digestId` is unknown.

Reads `soc.db` from the `soc_state` volume read-only; it writes nothing.
