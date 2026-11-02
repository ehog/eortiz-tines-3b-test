Part of GHAWA, a read-only GitHub Actions security analyzer. See the [workflow setup and runbook](../README.md).

Triggered by collected evidence. Parses YAML and compares deterministic findings at before/after snapshots. Returns findings plus line-referenced diffs and persists the review in its own `ghawa-evidence/<reviewId>.json` path. No model or external requests. `rules.ts` is the canonical shared rule implementation. Whole-step retries are safe for this content-addressed per-review write.
