Read-only JSON feed behind the console.

**Trigger:** `GET /ds-governance-api` (route auth: space members).

Reads the `ds_governance` volume read-only and returns every submission (with findings, model-policy verdict, bypass detail, credential references, and the code payload), the full audit ledger, raised security events, and the policy configuration from [model-policy.ts](model-policy.ts) and [bypass.ts](bypass.ts). If the ledger has never been seeded it returns `seeded: false` and empty arrays instead of failing. Contract in [api.json](api.json).

Logs `event=api.served …`.
