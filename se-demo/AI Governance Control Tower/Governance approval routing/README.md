Routes flagged builds and unapproved tools through Real Chemistry's approval chain.

**Trigger:** linked from [Security fix suggestions](<../Security fix suggestions/script.ts>). Links to [ROI and duplication ledger](<../ROI and duplication ledger/script.ts>).

**Stages** ([stages.ts](stages.ts)): AI Working Group → AI Board → Business review → Security / IT review → Finance verification → Trial → Implement / Kill.

**Fast track:** items in use under one week, low or medium risk, and with no open spillage finding take a shortened lane (Working Group → Security/IT → Trial → Implement/Kill) that skips full Board and Business review.

An item is opened for any build that is unowned, not healthy, high risk, or has an open finding, and for any shadow AI tool sitting in `review`.

**Audit:** every open, lane change and stage change appends a sequential record to `/storage/ai_governance/audit.json` with actor, action, field, prior value, new value and note. Records are only ever appended — human decisions recorded by [Governance actions](<../Governance actions/script.ts>) are authoritative and are never recomputed away.

**Output:** `/storage/ai_governance/pipeline.json`, `/storage/ai_governance/audit.json`.
