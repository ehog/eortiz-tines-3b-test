Triggered by GET `/incidents`. Members of the eortiz space can call it. A `limit` query parameter from 1 to 100 selects the page size; omitting it returns 25 cases.

Reads the newest Falcon cases, then loads each case and the alert records referenced by its evidence. Stdout is a complete HTTP response. A successful body looks like `{ "total": number, "incidents": [...] }`. Each incident's `events` list contains alert evidence with detection details, plus NG-SIEM event and lead ids when the case has them. Alert details are capped at 100 composite ids per request.

Uses the CrowdStrike connector. Requests go to `$CROWD_STRIKE_URL` with no credential of their own:

- `GET /cases/queries/cases/v1`
- `POST /cases/entities/cases/v2`
- `POST /alerts/entities/alerts/v2` when a case has alert evidence

The Falcon API client needs Cases: Read, and Alerts: Read to expand alert evidence. A bad `limit` returns HTTP 400. A CrowdStrike error returns HTTP 502 and fails the step.
