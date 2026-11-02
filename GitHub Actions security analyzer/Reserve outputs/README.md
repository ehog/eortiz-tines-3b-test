Part of GHAWA, a read-only GitHub Actions security analyzer. See the [workflow setup and runbook](../README.md).

Triggered by a finalized review ID. Commits one output reservation in the exclusive review ledger before any external write. Computes independent GitHub/Slack flags from explicit live policy and report mode. Suppresses repeats. Emits `reviewId` and `plan`. Deleted branches and skipped reviews do not publish checks; Slack requires high/critical findings and a configured channel. Audit records the reservation, not a claim that delivery occurred.
