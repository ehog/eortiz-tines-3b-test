The demo console's intake, identical in shape to [Alert Webhook](<../Alert Webhook/README.md>) so injected alerts travel the real gate path.

- **Trigger:** `POST /api/test-alert`, space auth. No `output`, so the browser gets `202 Accepted`.
- **Input:** `{ "scenario": "<id>" }` to fire a scenario pack from [scenarios.ts](./scenarios.ts), or `{ "alert": { ... } }` / `{ "alerts": [...] }` for a custom alert.
- **Output:** one JSON line per alert, `{ "intake": "console", "scenario": "<id|custom>", "alert": { ... } }`, to [Score Alert](<../Score Alert/README.md>).
- Scenario ids are also exposed to the console by [Console API](<../Console API/README.md>), which keeps a mirrored copy of `scenarios.ts`.
