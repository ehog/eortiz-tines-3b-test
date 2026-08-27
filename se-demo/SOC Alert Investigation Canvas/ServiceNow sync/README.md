Linked from `Summarize`, or re-runnable via `POST /api/servicenow`.

Looks for an existing Security Incident (`sn_si_incident`) with this alert's correlation id — `MDE-<incidentId>` or `SENTINEL-<incidentNumber>`. If none exists it creates one; otherwise it appends the enrichment digest as a work note, so a repeat alert never duplicates a ticket.

The digest carries the disposition, confidence, summary, per-source record counts, the entity list and the recommended actions. Writes `<id>/servicenow.json`.

Mocked: `client.ts` derives a ticket number from the correlation id and backs "does this ticket already exist" with the tickets recorded in previous investigations. Flip `USE_MOCK` to `false` and attach a ServiceNow connector to go live.
