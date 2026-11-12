Polls the CrowdStrike Falcon Alerts API every 5 minutes (published only) and forwards every new alert to [Score Alert](<../Score Alert/README.md>), the same as [Alert Webhook](<../Alert Webhook/README.md>).

- Queries `/alerts/queries/alerts/v2` for alerts with `created_timestamp` at or after the stored cursor, then fetches the full alerts from `/alerts/entities/alerts/v2`.
- Maps Falcon fields onto the gate's alert shape: `severity_name` → severity (informational counts as low), `confidence` 0–100 → low/medium/high (<50 / 50–79 / ≥80), `device.hostname` → host, `user_name` → user, `sha256` → indicator, plus tactic/technique tags. Falcon details are kept under `raw.falcon`.
- The cursor (`cursor.json`) is stored in the `crowdstrike_cursor` volume. It keeps the newest timestamp plus the IDs seen at that timestamp, so alerts aren't ingested twice. The first run looks back 15 minutes.
- Picks up to 2,000 alerts per run and emits nothing when there are no new alerts.
- Uses the CrowdStrike connector, which handles OAuth.
