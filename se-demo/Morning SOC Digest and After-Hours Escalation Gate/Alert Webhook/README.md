Public-facing intake for the after-hours escalation gate.

- **Trigger:** `POST /alerts`, `route_auth = "external_id"` (`route_type = "webhook"`). Call it with the route's generated `external_id` query parameter. No `output`, so senders get `202 Accepted` while the alert flows downstream.
- **Input:** a single alert object, an array of them, or `{ "alerts": [...] }`. Vendor field names are accepted loosely — `hostname`/`device`/`computer`, `userName`/`upn`, `sev`/`priority`, and so on — and flattened by `normalizeAlert` in `soclib.ts`.
- **Output:** one JSON line per alert, `{ "intake": "webhook", "alert": { ... } }`, to [Score Alert](<../Score Alert/README.md>).
- Exits nonzero if the payload contains no alert objects.
