The escalation gate itself.

- **Trigger:** linked from both intake steps; accepts newline-delimited `{ intake, alert }` envelopes (or bare alert objects).
- **Behaviour:** loads `config`, `critical_assets` and the demo clock from the `soc_state` volume, then for each alert scores four weighted factors — severity, detection confidence, asset criticality (CMDB hostname lookup) and business impact — and decides:
  - business hours → `bypass_business_hours` (recorded, not paged),
  - score ≥ `pageThreshold` → `page`,
  - score < `suppressBelowScore` → `suppressed`,
  - otherwise → `deferred` and queued for the morning digest.
- **Audit:** every alert is written to `alerts` and `gate_decisions` with the score, threshold, factor breakdown, clock mode and a plain-English reason. Deferrals also land in `deferred_queue`.
- **Output:** only `page` decisions are emitted (`{ alert, result, config, intake, scenario }`) to [Page On-Call](<../Page On-Call/README.md>); other decisions produce no stdout, which stops the chain.
- The decision time is the alert's own `receivedAt`, so re-scoring the same alert is idempotent and step tests are deterministic. Pinned tests cover the page, defer and business-hours cases.
- **Volume:** `soc_state`, exclusive writer.
