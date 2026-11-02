Stands in for the Onyx Security asset API until a real connector is available. Triggered by HTTP requests to `/onyx/api` (space auth), and it is the only step that creates assets.

All state lives in the shared SQLite database at `/storage/mock_state/mock.db` (volume `mock_state`, mounted exclusive because this step writes). Schema and seed data are in [db.ts](db.ts); request parsing helpers in [http.ts](http.ts); the endpoint logic in [script.ts](script.ts).

**Asset model** (inferred from Onyx's shadow-AI discovery positioning): `id`, `name`, `category` (`genai_app`, `browser_extension`, `mcp_server`, `ai_agent`, `model`, `ai_saas`), `vendor`, `risk_score` (0–100), `discovered_by` (`browser_agent`, `network`, `saas_scan`), `first_seen_user`, `status` (`blocked` → `pending_review` → `allowed` / `denied`).

**Endpoints** — see [api.json](api.json). Because 3B routes match a single path, the resource is selected with query parameters rather than path segments (path segments such as `/onyx/api/assets/AST-1003` are also honoured if the platform delivers them):

- `GET /onyx/api` — list assets, optional `?status=`
- `GET /onyx/api?id=AST-1003` — one asset
- `POST /onyx/api` — register a discovered asset. **Status is always forced to `blocked`** and an `asset.created` event is queued.
- `PATCH /onyx/api?id=AST-1003` — update `status`, `justification`, `approver`, `issue_key`

Creating an asset queues an event in the `events` table and links to [Onyx asset created](<../Onyx asset created/README.md>), which drains it. Every other request also runs that step; it exits without output when there is nothing new, which stops the chain.

The first run seeds six representative assets so the portal is not empty.
