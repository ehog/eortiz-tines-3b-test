Part of GHAWA, a read-only GitHub Actions security analyzer. See the [workflow setup and runbook](../README.md).

Triggered by either receiver's full HTTP response. Ignores rejected envelopes. Uses an exclusive SQLite transaction to reserve delivery and repository/ref/before/after identity. Emits normalized event JSON only for a new review. Duplicate deliveries emit zero bytes, suppressing downstream processing. Admission capacity is bounded; no automatic expiration weakens replay protection. No external service.
