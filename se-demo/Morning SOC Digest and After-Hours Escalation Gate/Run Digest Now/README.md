Lets the console build a digest on demand instead of waiting for 06:00 ET.

- **Trigger:** `POST /api/run-digest`, space auth. No `output`, so the browser gets `202 Accepted`.
- **Output:** `{ "trigger": "manual", requestedBy, requestedAt }` to [Collect Overnight Activity](<../Collect Overnight Activity/README.md>), whose schedule check is skipped for manual runs. `requestedBy` comes from the platform-supplied `x-3b-authenticated-email` header.
