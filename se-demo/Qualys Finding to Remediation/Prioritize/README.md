Scores every finding, explains the score in plain language, and sets the SLA date the owning team's
change will inherit.

**Triggers** — linked from [Normalize And Group](<../Normalize And Group/README.md>); also the route
`/qualys-remediation/run/prioritize`, which replays the last recorded normalize payload when called with
no body.

**Scoring** — five weighted factors in [scoring.ts](scoring.ts), normalised to 0–100:

| Factor | Default weight | Input |
| --- | --- | --- |
| Qualys severity | 30 | severity 1–5, linear |
| CVSS base score | 25 | CVSS v3 base, linear |
| Exploitation status | 20 | full for CISA KEV, 60% for exploited in the wild, none otherwise |
| Asset criticality | 15 | critical 100%, high 75%, medium 50%, low 25% |
| Internet exposure | 10 | internet 100%, dmz 80%, internal 35%, isolated 10% |

Bands are critical at 80+, high at 60+, medium at 40+ and low below that; SLAs are 3, 7, 30 and 90 days.
The high-priority threshold that gates the AI stage is the high band's floor. Weights are read from
`pipeline_state` at runtime, so the console's sliders change scoring without a code change; bands, SLA
lengths and the threshold are code.

**Output** — each finding gains a `risk` object: `risk_score`, `risk_band`, `sla_days`, `sla_due`, a
`factors[]` array showing the points each factor contributed out of its maximum, a `high_priority` flag,
and an `explanation` naming the top contributors, any factor that scored zero, and what happens next.
Each group gains the highest score, band and tightest SLA date within it, and groups are sorted by risk.

SLA dates are computed from the run's reference timestamp shifted by the demo clock, so every finding in
a run is dated consistently and the same input always produces the same output.

**Storage** — `pipeline_state` exclusive, for the weights and the stage record.

**Tests** — a pinned test scores a KEV, internet-facing, critical-asset finding against a low-severity
internal one and asserts both scores, bands, SLA dates and explanations.
