Emails the digest.

- **Trigger:** linked from [Write Digest](<../Write Digest/README.md>).
- **Behaviour:** builds a `multipart/alternative` message (Markdown text part, styled HTML part) and sends it with the Gmail API to `delivery.emailTo` from the saved config.
- **Side effect:** records `email_status` on the digest row and a timeline entry.
- **Output:** `{ digestId, emailTo, messageId }`. Exits nonzero on a Gmail error; `retry_seconds` retries twice.
- **Connector:** Gmail (`eortiz@tines.io`). **Volume:** `soc_state`, exclusive writer.
- **Notifications:** skips the Gmail call and records `email_status = "skipped: digest email notifications disabled"` when `notifications.digestEmail` is off, unless the payload sets `force` (a manual send from [Send Digest Notifications](<../Send Digest Notifications/README.md>)). A payload whose `channels` list omits `email` exits without sending.
