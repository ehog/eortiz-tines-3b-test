`GET /api/investigation?id=<investigationId>` returns the assembled record the app renders: normalized incident, entities, per-source results and data, timeline, summary, ServiceNow ticket, action history, the merged structured log, the screenshot manifest, and a `status` object the live run view animates.

`GET /api/investigation` with no id returns the 25 most recent investigations with their dispositions and ticket numbers.

Also issues the containment approval token — a SHA-256 digest over the investigation id and device name — which `Isolate endpoint` recomputes and verifies. Mounts the volume read-only.
