Deterministic static scan of the submitted artifact — regex and structural rules only, no model calls.

**Trigger:** upstream [Deployment Request](<../Deployment Request/script.ts>) (or [Review Decision](<../Review Decision/script.ts>) replays via the shared library).

Rule families in [script.ts](script.ts):

| Prefix | Checks |
|---|---|
| `SEC-00x` | hardcoded API keys, tokens, passwords, cloud key material, private keys |
| `PHI-00x` | patient identifiers, MRN, date of birth, embedded email lists, clinical tables — the Microsoft Purview overlap |
| `NET-001` | outbound calls to domains outside the egress allowlist |
| `HND-00x` | missing error handling, wildcard/admin credential scope, disabled TLS verification, shell execution |

Each finding carries a severity and a weight. Weights sum to a risk score capped at 100, which sets the verdict: `auto-approve` below 20, `needs-review` 20–70, `auto-block` above 70.

Adds a `scan` object to the submission and logs `event=policy.scan …` with every rule id that fired.
