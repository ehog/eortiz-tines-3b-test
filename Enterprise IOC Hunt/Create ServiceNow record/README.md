Mocked ServiceNow incident creation, triggered by [Combine report](<../Combine report/script.ts>).

Writes the full report to `/storage/iochunt/findings/<huntId>.json` — the stand-in for the record attachment — then generates a `sys_id` and `INC00…` number and stores both on the hunt row so the report page can display them. Urgency, impact and state reflect whether anything was found, and the description lists every indicator with its verdict plus any incomplete source.

To make this real, attach a ServiceNow connector and POST the same record body to `/api/now/table/incident`, then upload the findings file to the Attachment API.
