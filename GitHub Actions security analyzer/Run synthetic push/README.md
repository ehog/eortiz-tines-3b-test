Part of GHAWA, a read-only GitHub Actions security analyzer. See the [workflow setup and runbook](../README.md).

Triggered by a space-authenticated POST with `scenario`. Produces the same accepted-event envelope as the live receiver, but marks it `mode: fixture` and uses stable synthetic delivery and commit IDs. Repeats intentionally exercise deduplication. No connector or external write. Audit records identify the synthetic review.
