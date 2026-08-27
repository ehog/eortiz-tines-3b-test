Linked from `Build timeline`, or re-runnable via `POST /api/summarize`.

Sends the incident, entities, full timeline and a condensed view of each tool's raw data to Claude (`claude-sonnet-5`) through the Anthropic connector. Long arrays are trimmed before the request because the timeline already carries the narrative. The system prompt forbids inventing any fact not present in the evidence and requires every evidence item to cite timeline event ids.

Returns `{headline, summary, attackNarrative, disposition, confidence, evidence[], gaps[], recommendedActions[]}`. The disposition is normalized to `benign` / `needs_review` / `likely_true_positive`, confidence is clamped to 0–100, and cited event ids that do not exist in the timeline are dropped. Writes `<id>/summary.json` and triggers `ServiceNow sync`.
