Read-only JSON snapshot that backs the dashboard.

**Route:** `GET /ai-governance/data` — space members only. Contract in [api.json](api.json).

Assembles everything the app needs from the `ai_governance` volume (mounted read-only): KPIs, source coverage, build inventory, spillage findings, fix suggestions, shadow AI state, governance pipeline, ROI history and the last 400 audit records. Returns `503 not_collected` when [Inventory collector](<../Inventory collector/script.ts>) has never run, so the app can say "not collected yet" instead of showing zeros.

Open spillage alerts exclude findings whose fix has been approved.
