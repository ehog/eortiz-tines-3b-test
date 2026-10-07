Appends the final disposition of the run to the immutable ledger.

**Trigger:** upstream [Deploy to Production](<../Deploy to Production/script.ts>).

Writes one `audit` row — timestamp, submission, actor, action (`deployment.promoted` or `disposition.<status>`), the policy ids that fired, the reviewer comment, and the deployment detail — to the `ds_governance` volume via [db.ts](db.ts). Rows are only ever appended; nothing updates or deletes them, and the volume survives across runs.

Logs `event=audit.appended …` with the running ledger size.
