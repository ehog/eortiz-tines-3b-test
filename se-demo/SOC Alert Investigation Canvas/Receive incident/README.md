Triggered by `POST /incident` (space auth) or by an internal caller such as the demo launcher, which appends `?id=<investigationId>` so the UI can navigate straight to the live run. Without that parameter an id is generated.

Detects the payload shape — an `alerts` array or a bare `incidentId` reads as Defender, anything with `properties` reads as Sentinel — and normalizes both into one object: `{investigationId, source, vendorId, correlationId, title, description, severity, status, alertTime, receivedAt, vendorEntities, raw}`. Severity collapses to `high`/`medium`/`low`/`informational`, and `alertTime` prefers the earliest activity timestamp the vendor supplied.

Writes `<id>/incident.json` to the `investigations` volume and responds `202` with the id, source, title, severity and alert time. `Extract entities` is linked and reads that HTTP response body.
