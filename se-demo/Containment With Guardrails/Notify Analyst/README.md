Linked from [Containment Orchestrator](<../Containment Orchestrator/README.md>); stdin is the run summary. Posts a Slack message to channel `C0A8P2B0Y04` via `chat.postMessage` using the attached Slack connector.

Sends nothing when the run ended `contained` (exit 0, no output). Otherwise the message states what succeeded, what failed (stage, classification, HTTP status, attempt count, error body), the current system state (ticket number and state, isolation state, whether it is contained, whether it is safe to retry), the guardrail that was applied, and a button linking to the console with `?resume=<runId>` so the analyst resumes from the failed step instead of restarting.

Fails (nonzero) if Slack rejects the message; `retry_seconds` gives it two more attempts.
