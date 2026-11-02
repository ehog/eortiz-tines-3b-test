Records human decisions from the Control Tower.

**Route:** `POST /ai-governance/action` — space members only. Contract in [api.json](api.json).

Three actions: `fix_decision` (approve/reject a proposed security fix), `tool_decision` (allow/block a shadow AI tool), `advance_stage` (move a governance item forward, or close it as implemented/killed).

Every call appends an immutable audit record to `/storage/ai_governance/audit.json` with actor, action, field, prior value and new value. The actor is taken from the spoof-proof `x-3b-authenticated-email` header the platform adds to authenticated routes — never from the request body.

This is the only step that writes human decisions; the scheduled pipeline steps read them and never overwrite them.
