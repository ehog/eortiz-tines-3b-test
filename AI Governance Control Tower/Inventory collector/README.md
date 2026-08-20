Discovers every AI-generated build in the org and writes the canonical inventory.

**Trigger:** cron `0 7 * * *` (daily, 07:00 UTC). Links to [Data spillage scanner](<../Data spillage scanner/script.ts>) and [Shadow AI detector](<../Shadow AI detector/script.ts>).

**Sources** (all mocked today, one per adapter in [sources.ts](sources.ts)): 3B / Tines builds, Claude Code commits, Replit projects, GitHub security suite findings. Each source declares the real endpoint it would call and a `coverage_pct` — Replit at 74% and GitHub code scanning at 68% — which the dashboard surfaces so counts are never presented as complete.

**Swapping in a real API:** replace the seed array in the relevant block of `sources.ts` with a `fetch` to that source's `endpoint` (auth arrives via a connector, so no keys in code) and keep the `Raw` record shape. Nothing downstream knows where a record came from.

**Output:** `/storage/ai_governance/inventory.json` — one normalized record per build with owner, team, type, model, status, classification, credentials referenced, run counts, egress, AI-code provenance, captured log/IO signals, and a computed `risk_score`. The approved-egress list and risk weights live in [script.ts](script.ts); teams and the normalizer model in [config.ts](config.ts).
