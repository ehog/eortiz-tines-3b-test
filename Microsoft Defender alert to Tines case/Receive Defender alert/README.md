Webhook entry point for Microsoft Defender alerts at `/defender-alert`.

- `POST` a Defender alert as JSON (Microsoft Graph `security/alerts_v2` shape — a bare alert, `{ "value": [alert] }`, or `{ "alert": {...} }`) to process a real alert.
- `GET` or an empty `POST` generates a realistic **synthetic** Defender for Endpoint alert (marked `synthetic: true`), since no Microsoft Defender connector is configured.

Outputs the alert JSON to **Create Tines case**.
