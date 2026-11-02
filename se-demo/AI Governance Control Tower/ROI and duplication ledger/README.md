Aggregates hours saved, translates them to dollars, and flags duplicated effort.

**Trigger:** linked from [Governance approval routing](<../Governance approval routing/script.ts>).

**Headline metric is personnel hours saved.** The dollar figure is hours × a configurable blended rate (`BLENDED_HOURLY_RATE`, default $96/hr) set in [config.ts](config.ts) — it is a translation, not a second measurement.

Builds a 90-day daily history per team by spreading each build's monthly hours across working days with a two-week ramp from its creation date. Today is marked `partial` and excluded from every total, so no window is shown as complete when it isn't.

**Duplicate detection:** stemmed-token overlap on build names (Jaccard ≥ 0.5) plus shared credentials, reported with the duplicated hours per month and whether the pair crosses team boundaries. The app states plainly that this finds obvious twins and misses semantically similar builds with unrelated names.

**Output:** `/storage/ai_governance/roi.json`.
