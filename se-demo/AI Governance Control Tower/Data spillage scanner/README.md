Scans every enumerated surface of every build for sensitive-data exposure.

**Trigger:** linked from [Inventory collector](<../Inventory collector/script.ts>). Links to [Security fix suggestions](<../Security fix suggestions/script.ts>).

Reads `inventory.json` and runs the detection library in [patterns.ts](patterns.ts) over each build's run logs and declared inputs/outputs, plus an egress check against the approved processor list. Categories: PHI, PII, secrets in plaintext, client-confidential content, unapproved egress.

Matches are stored **masked** — the raw identifier never leaves the scanner. One finding per build/pattern pair, severity-ranked.

**Output:** `/storage/ai_governance/spillage.json` (`findings[]` with build, owner, severity, matched pattern, masked evidence, surface, rationale) plus a coverage note stating that absence of a finding on a partially covered source is not evidence of safety.

Add or tune detections by editing `PATTERNS` in [patterns.ts](patterns.ts).
