Lists recent CrowdStrike cases and the alert and event evidence attached to them. Falcon retired the Incidents API in March 2026; cases are the replacement, and this workflow still presents them as incidents.

The only trigger is an HTTP GET on `/incidents`. Members of the eortiz space can call it. Optional query parameter `limit` (1–100, default 25) chooses how many of the most recently created cases to return. The response is JSON: a `total` count from CrowdStrike and an `incidents` array. Each incident includes status, severity, timing, assignee, tags, and an `events` array. Alert evidence is expanded from the Alerts API. NG-SIEM event evidence and leads are returned as ids.

The step calls Falcon on the host in `CROWD_STRIKE_URL`. It only reads data. It does not create cases, add evidence, or change any other CrowdStrike record.

To change the page size default or the fields returned, edit [List incident events/script.ts](<List incident events/script.ts>). The CrowdStrike connector is attached on that step. The Falcon API client behind that connector needs the Cases: Read scope, and Alerts: Read if alert evidence should include detection details.
