Opens a Tines case in the **3B cases** team (`team_id` 132137) from the incoming Defender alert using `POST /api/v2/cases` via the Tines Cases connector.

- Maps Defender severity to case priority (high/medium/low/informational → high/medium/low/info).
- Description summarises device, user, process, SHA256, MITRE techniques and the Defender link.
- Adds tags, metadata (alert/incident IDs, device, user), triage tasks, a recommended-actions note, and the raw alert as a JSON file block.

Returns `201` with the case ID and URL as the HTTP response.
