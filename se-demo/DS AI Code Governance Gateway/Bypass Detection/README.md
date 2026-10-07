Checks that the submission actually came through governed infrastructure — the control that stops ungoverned AI-generated code from reaching production around the funnel.

**Trigger:** upstream [Model Policy Check](<../Model Policy Check/script.ts>).

Compares `repo`, `pipeline`, and `runner` against the sanctioned inventories in [script.ts](script.ts):

- `BYP-001` — repository not in the sanctioned repo inventory
- `BYP-002` — pipeline is not a sanctioned CI/CD pipeline
- `BYP-003` — build runner is unsanctioned (self-hosted or unregistered)

Any hit sets `bypass_attempt = true`, which [Record Intake](<../Record Intake/script.ts>) turns into a hard block plus a critical security event. Logs `event=bypass.check …` and, on a hit, `event=security.alert …`.
