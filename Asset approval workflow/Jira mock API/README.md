Stands in for Jira Cloud. Triggered by HTTP requests to `/jira/api` (space auth). Responses are shaped like Jira REST v3 issues (`key`, `fields.summary`, `fields.status.name`, `fields.customfield_asset_id`), so the surrounding steps need little change when a real Jira connector replaces it.

Resource selection uses query parameters because a 3B route matches one path; the Jira-style paths (`/rest/api/3/issue/AIGOV-1/transitions`) are also honoured if present. Full contract in [api.json](api.json):

- `GET /jira/api?resource=search` — list issues, optional `?status=`
- `GET /jira/api?key=AIGOV-1` — one issue
- `POST /jira/api` — create an approval issue (`fields.summary`, `fields.customfield_asset_id`)
- `POST /jira/api?resource=transitions&key=AIGOV-1` — move the issue between `Open`, `In Review`, `Allow`, `Deny`

A status transition writes an `issue_changelog` row and queues a `jira:issue_updated` event, then links to [Jira webhook](<../Jira webhook/README.md>) which turns it into a decision. Requests that change nothing queue nothing, so the chain stops.

State lives in `/storage/mock_state/mock.db` (exclusive volume). Logic in [script.ts](script.ts), issue creation shared via [jira.ts](jira.ts).
