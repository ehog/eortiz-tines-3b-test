The two human-in-the-loop decisions.

**Route** — `POST /atlas/action`, space-authenticated. See [api.json](api.json)
for the contract.

| Decision | Effect |
| --- | --- |
| `quarantine` + `approve` | The PHI finding is a false positive: the record is released and published |
| `quarantine` + `dismiss` | The finding is real: the record stays withheld |
| `remediation` + `runId` | The AI-proposed field remapping takes effect **from the next run onwards** |

The acting operator comes from the platform-injected `x-3b-authenticated-email`
header — never from the request body, which the caller controls. Every decision
is written to the store with its actor and timestamp, and logged.

Approved remediations live in `mapping_overrides` and are read by
[Ingest](../Ingest/script.ts) at the start of each run, then applied by
[Normalize](../Normalize/script.ts). Nothing a model proposes is applied until
this endpoint records a human approval.

**Storage** — the `atlas` volume, read-write with exclusive writer scheduling.
