Emails the digest.

- **Trigger:** linked from [Write Digest](<../Write Digest/README.md>).
- **Behaviour:** builds a `multipart/alternative` message (Markdown text part, styled HTML part) and sends it with the Gmail API to `delivery.emailTo` from the saved config.
- **Side effect:** records `email_status` on the digest row and a timeline entry.
- **Output:** `{ digestId, emailTo, messageId }`. Exits nonzero on a Gmail error; `retry_seconds` retries twice.
- **Connector:** Gmail (`eortiz@tines.io`). **Volume:** `soc_state`, exclusive writer.
