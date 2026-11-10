Turns Microsoft Defender alerts into Tines cases.

1. **Receive Defender alert** — webhook at `/defender-alert`. Accepts a posted Defender alert, or generates a synthetic one when called with no body (no Defender connector is configured yet).
2. **Create Tines case** — opens a case in the Tines **3B cases** team with priority, description, tags, metadata, tasks and the raw alert attached, then returns the case URL.

To use real alerts, add a Microsoft Defender for Endpoint connector and poll `GET /api/alerts` on a schedule, or forward alerts from Defender/Sentinel to the webhook.
