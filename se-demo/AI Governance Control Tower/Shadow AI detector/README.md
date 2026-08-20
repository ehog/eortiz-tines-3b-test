Compares observed AI tool usage against a self-updating allow/block list.

**Trigger:** linked from [Inventory collector](<../Inventory collector/script.ts>).

**Telemetry:** two vendor-generic feeds declared in [feed.ts](feed.ts) — "Microsoft Defender" (endpoint network events) and "EDR / SIEM" (aggregated proxy logs). Each carries the query it would run; swap `OBSERVATIONS` for the real query result and keep the shape.

**The list is state, not config.** `/storage/ai_governance/shadow.json` holds every tracked tool with its decision (`allow` / `block` / `review`), enrichment (vendor, category, HQ, training behaviour, BAA status, risk notes), usage counts, and an append-only `changes[]` log. On the first run it seeds from `BASELINE` so the history has depth; after that the volume is the source of truth. Each run:

1. refreshes usage on known tools,
2. flags anything unrecognized as `review`, enriches it, and proposes `allow` or `block` from its risk score,
3. retires allow-list entries with no observed usage in 60 days.

Decisions made in the app are written back by [Governance actions](<../Governance actions/script.ts>) and are never recomputed away. The enrichment model is a config value (`SHADOW_ENRICHMENT_MODEL`).
