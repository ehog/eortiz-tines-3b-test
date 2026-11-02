Proposes one concrete security or bug fix per spillage finding.

**Trigger:** linked from [Data spillage scanner](<../Data spillage scanner/script.ts>). Links to [Governance approval routing](<../Governance approval routing/script.ts>).

**Scope guard:** security and bug fixes only. Workflow optimisation, cost tuning and productivity advice are explicitly out of scope — that constraint is stated in `SYSTEM_PROMPT` in [suggest.ts](suggest.ts) and enforced by the recipe library.

Each suggestion carries a title, the target surface, a unified-diff style before/after, the rationale, the risk if ignored, the model that produced it, and a `pending` / `approved` / `rejected` decision. Prior human decisions are preserved across runs.

**Model:** `FIX_MODEL` config value (default `claude-sonnet-4-5`), reported in the UI next to each suggestion. To use a live model, replace the recipe lookup in `propose()` with a request to the configured provider using `SYSTEM_PROMPT` and the finding as the user turn — the returned shape is what the app and approval routing depend on.

**Output:** `/storage/ai_governance/suggestions.json`.
