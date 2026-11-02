Part of GHAWA, a read-only GitHub Actions security analyzer. See the [workflow setup and runbook](../README.md).

Triggered by `POST /ghawa/push`. Requires a GitHub HMAC over the exact request bytes, an allowlisted repository, live mode and a connector-backed Vault KV v2 secret. Rejects by default. Returns an HTTP `202` envelope carrying normalized `event`, `reviewId` and `statusUrl`; rejected envelopes contain no event and cannot reserve work. The external-ID route remains space-private in drafts. Appends acceptance/rejection audit records. Never persists the webhook secret.
