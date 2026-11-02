The run's verdict.

**Triggered by** [AI triage](<../AI triage/script.ts>).

The run is already fully recorded by this point, so this step exists to make the
outcome visible where operators watch:

- **failed** — exits non-zero, which surfaces the run as failed in the
  monitoring view and to any downstream alerting, with the owner-attributable
  payload (source, field, record, what changed, triage note) on stderr
- **degraded** — logs a warning and succeeds
- **clean** — quiet

Exiting non-zero is the only way a step reports failure, which is why the verdict
lives in its own step rather than inside Publish.
