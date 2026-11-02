Classifies the root cause of any run that failed or rejected records, and drafts
a remediation note for the data engineering owner.

**Triggered by** [Publish](../Publish/script.ts). Clean runs pass straight
through.

**Model** — `claude-haiku-4-5` via the Anthropic Messages API
(`POST {ANTHROPIC_BASE_URL}/messages`), through the attached connector. This is
classification, not reasoning, so it runs on the cheap/fast tier with a 500-token
cap and a 20-second timeout.

**The model sees metadata only** — source names, field names, reason codes and
counts. No record values, and therefore no clinical or patient data, are sent.

**It degrades gracefully.** With no connector, an API error or an unusable
response, the step falls back to a deterministic rule-based classification, so
the pipeline never fails because triage was unavailable. The stored note always
says which produced it.

Root causes: `schema_drift`, `encoding_issue`, `bad_mapping`, `source_outage`.

For `partner_csv` schema drift the step also attaches a **proposed fix** — a
field remapping — which does nothing until an operator approves it in the
console. Nothing the model suggests is ever applied automatically.
