Part of GHAWA, a read-only GitHub Actions security analyzer. See the [workflow setup and runbook](../README.md).

Triggered by `reviewId` and output receipts. Stores them in the exclusive review ledger and appends result audit records. No external request. Whole-step retries overwrite the same receipt fields, never resend notifications. Reports remain readable even when a destination failed or was disabled.
