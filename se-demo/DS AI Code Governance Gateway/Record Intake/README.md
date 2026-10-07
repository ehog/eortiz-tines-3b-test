The disposition engine and the first writer to the governance ledger.

**Trigger:** upstream [Credential Handling Demo](<../Credential Handling Demo/script.ts>).

Precedence, in order:

1. `bypass_attempt` → **blocked** (ungoverned origin)
2. scan verdict `auto-block` (risk > 70) → **blocked**
3. model policy violation → **pending** (mandatory security review)
4. scan verdict `auto-approve` (risk < 20) → **auto-approved**
5. otherwise → **pending**

Writes the submission row, appends a `submission.received` audit record with every policy id that fired, and raises security events for bypass attempts and model-policy violations. Storage is the `ds_governance` volume (SQLite at `/storage/ds_governance/governance.db`, exclusive writer) via [db.ts](db.ts).

Logs `event=intake.recorded …`.
